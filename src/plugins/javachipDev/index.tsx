/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { relaunch } from "@utils/native";
import definePlugin, { OptionType, ReporterTestable } from "@utils/types";
import type { Channel, MessageJSON, Role, UserJSON } from "@vencord/discord-types";
import { ChannelStore, ConfirmModal, GuildMemberStore, GuildRoleStore, GuildStore, openModal, Toasts, UserStore } from "@webpack/common";

const logger = new Logger("JavaChipDev");

// Keep author inline — do not add to Devs in constants.ts (personal plugin).
const Author = {
    name: "JavaChipDev",
    id: 431121227294179329n
};

const config = {
    apiUrl: "https://api-discord.javachip.dev",
    endpoints: {
        roleMention: "/role-mention",
        userMention: "/user-mention",
        channelCreate: "/channel-create",
    }
} as const;

type Endpoint = keyof typeof config.endpoints;

function getApiUrl() {
    return settings.store.apiUrl.trim().replace(/\/+$/, "") || config.apiUrl;
}

async function ensureApiCsp() {
    if (IS_WEB) return true;

    const apiUrl = getApiUrl();
    try {
        if (await VencordNative.csp.isDomainAllowed(apiUrl, ["connect-src"])) {
            return true;
        }
    } catch (error) {
        logger.error("Failed to check CSP allowlist", error);
    }

    const res = await VencordNative.csp.requestAddOverride(apiUrl, ["connect-src"], "JavaChipDev");
    if (res === "ok") {
        const host = new URL(apiUrl).host;
        openModal(modalProps => (
            <ConfirmModal
                {...modalProps}
                title="JavaChipDev host permission"
                subtitle={`${host} was allowed. Fully restart Discord for mentions to reach the API.`}
                confirmText="Restart now"
                cancelText="Later"
                variant="primary"
                onConfirm={relaunch}
            />
        ));
    } else if (res === "cancelled" || res === "unchecked") {
        Toasts.show({
            message: "JavaChipDev needs host permission to reach the API",
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { duration: 5000 }
        });
    }

    return res === "ok" || res === "conflict";
}

const settings = definePluginSettings({
    apiUrl: {
        type: OptionType.STRING,
        description: "JavaChip Dev API base URL (same server the Expo app uses)",
        placeholder: "http://localhost:3000",
        default: config.apiUrl
    },
    apiKey: {
        type: OptionType.STRING,
        displayName: "API Key",
        description: "Must match API_KEY on the JavaChip API / Expo app",
        placeholder: "dev-api-key",
        default: "84cc1c5a03deb2a8ea60b0083abb2155edb76084a7367ab6"
    },
    forwardRoleMentions: {
        type: OptionType.BOOLEAN,
        description: "Send events when a message mentions a role you have",
        default: true
    },
    forwardUserMentions: {
        type: OptionType.BOOLEAN,
        description: "Send events when a message mentions you",
        default: true
    },
    forwardChannelCreates: {
        type: OptionType.BOOLEAN,
        description: "Send events when a channel is created",
        default: true
    }
});

export default definePlugin({
    name: "JavaChipDev",
    authors: [Author],
    description: "API Bridge to Personal JavaChip Dev App",
    tags: ["Utility", "Developers"],
    reporterTestable: ReporterTestable.None,
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: MessageJSON; optimistic: boolean; }) {
            if (optimistic || !message) return;
            if (message.id && recentlyForwarded.has(message.id)) return;

            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) return;

            const channel = ChannelStore.getChannel(message.channel_id);
            const guildId = message.guild_id ?? channel?.guild_id;

            let forwarded = false;

            if (settings.store.forwardUserMentions && isCurrentUserMentioned(message, currentUser.id)) {
                forwarded = true;
                void sendDataToJavaChipDevApp("userMention", {
                    type: "userMention",
                    message: serializeMessage(message),
                    author: serializeUser(message.author),
                    channel: serializeChannel(channel),
                    guild: serializeGuild(guildId),
                    mentionedUser: serializeUser(currentUser)
                });
            }

            if (settings.store.forwardRoleMentions && guildId) {
                const roles = getMentionedOwnRoles(message, guildId);
                if (roles.length > 0) {
                    forwarded = true;
                    void sendDataToJavaChipDevApp("roleMention", {
                        type: "roleMention",
                        message: serializeMessage(message),
                        author: serializeUser(message.author),
                        channel: serializeChannel(channel),
                        guild: serializeGuild(guildId),
                        roles: roles.map(serializeRole)
                    });
                }
            }

            if (forwarded && message.id) {
                recentlyForwarded.add(message.id);
                if (recentlyForwarded.size > 200) {
                    const first = recentlyForwarded.values().next().value;
                    if (first) recentlyForwarded.delete(first);
                }
            }
        },

        CHANNEL_CREATE({ channel }: { channel?: Channel; }) {
            if (!settings.store.forwardChannelCreates || !channel) return;

            void sendDataToJavaChipDevApp("channelCreate", {
                type: "channelCreate",
                channel: serializeChannel(channel),
                guild: serializeGuild(channel.guild_id)
            });
        }
    },

    start() {
        void ensureApiCsp();
    }
});

const recentlyForwarded = new Set<string>();

function formatDisplayContent(message: MessageJSON) {
    let content = message.content ?? "";
    if (!content) return "";

    for (const user of message.mentions ?? []) {
        const label = ("globalName" in user && user.globalName) || user.username || user.id;
        content = content
            .replaceAll(`<@${user.id}>`, `@${label}`)
            .replaceAll(`<@!${user.id}>`, `@${label}`);
    }

    for (const roleId of message.mention_roles ?? []) {
        const guildId = message.guild_id;
        const role = guildId ? GuildRoleStore.getRole(guildId, roleId) : null;
        content = content.replaceAll(`<@&${roleId}>`, `@${role?.name ?? "role"}`);
    }

    content = content
        .replace(/<#(\d+)>/g, (_, id) => {
            const ch = ChannelStore.getChannel(id);
            return ch?.name ? `#${ch.name}` : "#channel";
        })
        .replace(/\s+/g, " ")
        .trim();

    return content;
}

function isCurrentUserMentioned(message: MessageJSON, currentUserId: string) {
    if (message.mentions?.some(user => user.id === currentUserId)) return true;
    return message.content?.includes(`<@${currentUserId}>`) || message.content?.includes(`<@!${currentUserId}>`);
}

function getMentionedOwnRoles(message: MessageJSON, guildId: string) {
    const myRoles = GuildMemberStore.getSelfMember(guildId)?.roles ?? [];
    const mentionedRoleIds = new Set(message.mention_roles ?? []);

    if (message.mention_everyone) mentionedRoleIds.add(guildId);

    const roles: Role[] = [];
    for (const roleId of mentionedRoleIds) {
        if (roleId !== guildId && !myRoles.includes(roleId)) continue;

        const role = GuildRoleStore.getRole(guildId, roleId);
        if (role) roles.push(role);
    }

    return roles;
}

function serializeMessage(message: MessageJSON) {
    return {
        id: message.id,
        content: message.content,
        displayContent: formatDisplayContent(message),
        timestamp: message.timestamp,
        channelId: message.channel_id,
        guildId: message.guild_id,
        mentionEveryone: message.mention_everyone,
        mentionRoles: message.mention_roles ?? [],
        mentions: (message.mentions ?? []).map(serializeUser)
    };
}

function serializeUser(user: UserJSON | { id: string; username?: string; globalName?: string; bot?: boolean; } | null | undefined) {
    if (!user) return null;

    return {
        id: user.id,
        username: "username" in user ? user.username : undefined,
        globalName: "globalName" in user ? user.globalName : undefined,
        bot: "bot" in user ? user.bot : undefined
    };
}

function serializeChannel(channel: Channel | undefined) {
    if (!channel) return null;

    let name: string | null = channel.name || null;
    let kind: "guild" | "dm" | "group_dm" | "unknown" = "unknown";

    if (channel.isDM?.()) {
        kind = "dm";
        const recipientId = channel.getRecipientId?.() ?? channel.recipients?.[0];
        const recipient = channel.rawRecipients?.[0] ?? (recipientId ? UserStore.getUser(recipientId) : null);
        const globalName =
            recipient && "global_name" in recipient && typeof recipient.global_name === "string"
                ? recipient.global_name
                : recipient && "globalName" in recipient && typeof recipient.globalName === "string"
                    ? recipient.globalName
                    : null;
        name = globalName || recipient?.username || "Direct Message";
    } else if (channel.isGroupDM?.()) {
        kind = "group_dm";
        if (channel.name) {
            name = channel.name;
        } else if (channel.rawRecipients?.length) {
            name = channel.rawRecipients.map(r => r.global_name || r.username).filter(Boolean).join(", ") || "Group DM";
        } else {
            name = "Group DM";
        }
    } else if (channel.guild_id) {
        kind = "guild";
        name = channel.name || null;
    }

    return {
        id: channel.id,
        name,
        type: channel.type,
        kind,
        guildId: channel.guild_id,
        parentId: channel.parent_id,
        topic: channel.topic,
        nsfw: channel.nsfw
    };
}

function serializeGuild(guildId: string | undefined) {
    if (!guildId) return null;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) return { id: guildId };

    return {
        id: guild.id,
        name: guild.name
    };
}

function serializeRole(role: Role) {
    return {
        id: role.id,
        name: role.name,
        color: role.color,
        colorString: role.colorString
    };
}

async function sendDataToJavaChipDevApp(endpoint: Endpoint, data: Record<string, unknown>) {
    const apiUrl = getApiUrl();
    const apiKey = settings.store.apiKey.trim();

    if (!apiKey) {
        logger.warn("Skipping request; no API key configured");
        Toasts.show({
            message: "JavaChipDev: set your API key in plugin settings",
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { duration: 4000 }
        });
        return;
    }

    if (!IS_WEB) {
        const allowed = await VencordNative.csp.isDomainAllowed(apiUrl, ["connect-src"]).catch(() => false);
        if (!allowed) {
            logger.warn("API host not in CSP allowlist; requesting permission");
            await ensureApiCsp();
            return;
        }
    }

    try {
        const response = await fetch(`${apiUrl}${config.endpoints[endpoint]}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            logger.error(`Failed to send ${endpoint} event: ${response.status} ${response.statusText}`, text);
            Toasts.show({
                message: `JavaChipDev API ${response.status} on ${endpoint}`,
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                options: { duration: 4000 }
            });
            return;
        }

        logger.info(`Sent ${endpoint} event`);
    } catch (error) {
        logger.error(`Failed to send ${endpoint} event`, error);
        Toasts.show({
            message: `JavaChipDev blocked reaching API (${endpoint}). Allow host + restart Discord.`,
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { duration: 6000 }
        });
        void ensureApiCsp();
    }
}
