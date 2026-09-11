/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { FluxDispatcher, GuildMemberCountStore, GuildMemberStore, GuildStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.ValleyLink as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    guildId: {
        type: OptionType.STRING,
        description: "ValleyRP Discord server (guild) ID",
        default: "1230995127611162694",
    },
    roleId: {
        type: OptionType.STRING,
        description: "Staff role ID that grants access to the support site",
        default: "1230997320775237763",
    },
    searchDepth: {
        type: OptionType.SELECT,
        description: "How thorough the member search should be. On a large server, a full dump only surfaces a small fraction of members — searching by username prefix finds far more, at the cost of time.",
        options: [
            { label: "Fast — single-character prefixes (~25s, 36 requests)", value: 1, default: true },
            { label: "Thorough — two-character prefixes (~13min, ~1300 requests)", value: 2 },
        ],
    },
});

// Discord doesn't hand a client the full member list up front, and a plain
// "give me everyone" request (query: "", limit: 0) gets heavily throttled
// for large guilds on a regular user session — see the single-request
// version of this that only surfaced 145 of 26,298 members. Targeted
// username-prefix searches (query: "<chars>", limit: 100) aren't throttled
// the same way, so we crawl the prefix space instead: request every
// single-character prefix, and optionally every two-character prefix for
// more coverage. Each match streams into GuildMemberStore as usual.
//
// Requests are sent strictly sequentially, spaced out to stay under
// Discord's documented gateway command rate limit (120 commands/60s across
// the whole connection) — going faster risks a gateway disconnect.
const SEARCH_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const REQUEST_SPACING_MS = 600;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchPrefix(guildId: string, query: string): Promise<void> {
    FluxDispatcher.dispatch({
        type: "GUILD_MEMBERS_REQUEST",
        guildIds: [guildId],
        query,
        limit: 100,
    });
    await sleep(REQUEST_SPACING_MS);
}

async function crawlMembers(guildId: string, depth: number): Promise<void> {
    // Cheap first pass: a plain dump is throttled, but whatever it does
    // return is free coverage before the prefix crawl starts.
    FluxDispatcher.dispatch({
        type: "GUILD_MEMBERS_REQUEST",
        guildIds: [guildId],
        query: "",
        limit: 0,
    });
    await sleep(2000);

    for (const a of SEARCH_CHARSET) {
        await searchPrefix(guildId, a);
    }

    if (depth >= 2) {
        for (const a of SEARCH_CHARSET) {
            for (const b of SEARCH_CHARSET) {
                await searchPrefix(guildId, a + b);
            }
        }
    }
}

export default definePlugin({
    name: "ValleyLink",
    description: "Syncs the ValleyRP staff role's Discord IDs into valley-support's users.json allowlist.",
    authors: [{ name: "James", id: 0n }],
    settings,

    commands: [
        {
            name: "sync valley staff",
            description: "Crawl the member list for the configured staff role and write matching Discord IDs to users.json",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                const { guildId, roleId, searchDepth } = settings.store;

                if (!GuildStore.getGuild(guildId)) {
                    sendBotMessage(ctx.channel.id, {
                        content: `I can't see a guild with ID \`${guildId}\` — check ValleyLink's plugin settings, and make sure you're actually in that server.`,
                    });
                    return;
                }

                const before = GuildMemberStore.getMemberIds(guildId).length;
                const total = GuildMemberCountStore.getMemberCount(guildId);
                const requestCount = SEARCH_CHARSET.length * (searchDepth >= 2 ? SEARCH_CHARSET.length + 1 : 1);
                const etaSeconds = Math.round((requestCount * REQUEST_SPACING_MS) / 1000);

                sendBotMessage(ctx.channel.id, {
                    content: `Crawling the member list for staff (depth ${searchDepth}, ~${etaSeconds}s, ${before}/${total} already known)…`,
                });

                await crawlMembers(guildId, searchDepth);

                const loaded = GuildMemberStore.getMemberIds(guildId).length;
                const userIds = GuildMemberStore.getMembers(guildId)
                    .filter(m => m.roles.includes(roleId))
                    .map(m => m.userId)
                    .sort();

                if (userIds.length === 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Found 0 members with role \`${roleId}\` (discovered ${loaded}/${total} members total, ${loaded - before} new this run). Nothing written — check the role ID.`,
                    });
                    return;
                }

                await Native.writeAllowlist(userIds);

                const completenessNote = loaded < total
                    ? ` Still short of the full member count (${loaded}/${total}) — some staff may not have been discovered yet. Re-run, or switch to "Thorough" in settings for more coverage. On a server this size, a client-side crawl can't guarantee 100% completeness no matter what — for that you'd need a bot with the Server Members REST endpoint.`
                    : "";

                sendBotMessage(ctx.channel.id, {
                    content: `Wrote ${userIds.length} staff ID(s) to users.json. Discovered ${loaded}/${total} members total (${loaded - before} new this run).${completenessNote}`,
                });
            },
        },
    ],
});
