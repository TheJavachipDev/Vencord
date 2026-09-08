/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, ReporterTestable } from "@utils/types";
import type { Channel, MessageJSON, Role, UserJSON } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, UserStore } from "@webpack/common";

const logger = new Logger("JavaChipDev");

const config = {
    apiUrl: "https://api.javachip.dev",
    endpoints: {
        roleMention: "/role-mention",
        userMention: "/user-mention",
        channelCreate: "/channel-create",
    }
} as const;

type Endpoint = keyof typeof config.endpoints;

const settings = definePluginSettings({
    apiUrl: {
        type: OptionType.STRING,
        description: "JavaChip Dev API base URL",
        placeholder: config.apiUrl,
        default: config.apiUrl
    },
    apiKey: {
        type: OptionType.STRING,
        displayName: "API Key",
        description: "API key used to authenticate with your JavaChip Dev app",
        placeholder: "your-api-key",
        default: ""
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
    authors: [Devs.JavaChipDev],
    description: "API Bridge to Personal JavaChip Dev App",
    tags: ["Utility", "Developers"],
    reporterTestable: ReporterTestable.None,
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: MessageJSON; optimistic: boolean; }) {
            if (optimistic || !message) return;

            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) return;

            const channel = ChannelStore.getChannel(message.channel_id);
            const guildId = message.guild_id ?? channel?.guild_id;

            if (settings.store.forwardUserMentions && isCurrentUserMentioned(message, currentUser.id)) {
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
        },

        CHANNEL_CREATE({ channel }: { channel?: Channel; }) {
            if (!settings.store.forwardChannelCreates || !channel) return;

            void sendDataToJavaChipDevApp("channelCreate", {
                type: "channelCreate",
                channel: serializeChannel(channel),
                guild: serializeGuild(channel.guild_id)
            });
        }
    }
});

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

    return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
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
    const apiUrl = settings.store.apiUrl.trim().replace(/\/+$/, "") || config.apiUrl;
    const apiKey = settings.store.apiKey.trim();

    if (!apiKey) {
        logger.warn("Skipping request; no API key configured");
        return;
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
            logger.error(`Failed to send ${endpoint} event: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        logger.error(`Failed to send ${endpoint} event`, error);
    }
}