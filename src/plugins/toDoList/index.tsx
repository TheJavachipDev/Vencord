/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { FluxDispatcher, SelectedChannelStore, SelectedGuildStore } from "@webpack/common";

import { TodoPanel } from "./TodoPanel";

export const cl = classNameFactory("vc-todolist-");

export const TODO_COLORS = [
    { id: "default", label: "Default", value: null },
    { id: "red", label: "Red", value: "#ed4245" },
    { id: "orange", label: "Orange", value: "#f26522" },
    { id: "yellow", label: "Yellow", value: "#fee75c" },
    { id: "green", label: "Green", value: "#57f287" },
    { id: "teal", label: "Teal", value: "#1abc9c" },
    { id: "blue", label: "Blue", value: "#5865f2" },
    { id: "purple", label: "Purple", value: "#9b59b6" },
    { id: "pink", label: "Pink", value: "#eb459e" },
] as const;

export type TodoColor = (typeof TODO_COLORS)[number]["value"];

export interface TodoItem {
    id: string;
    text: string;
    completed: boolean;
    createdAt: number;
    color?: TodoColor;
    channelId?: string | null;
    guildId?: string | null;
}

const Author = {
    name: "JavaChipDev",
    id: 431121227294179329n
};

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

export const settings = definePluginSettings({
    panelOpen: {
        type: OptionType.BOOLEAN,
        description: "Whether the to-do sidebar is open",
        default: false,
        hidden: true
    },
    todos: {
        type: OptionType.CUSTOM,
        default: [] as TodoItem[]
    },
    openByDefault: {
        type: OptionType.BOOLEAN,
        description: "Open the to-do sidebar when Discord starts",
        default: false
    },
    linkCurrentChannelByDefault: {
        type: OptionType.BOOLEAN,
        description: "Automatically link new tasks to the current channel",
        default: true
    }
});

function TodoListIcon({ open }: { open: boolean; }) {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                d={open
                    ? "M9 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0-5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM9 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4 9.5h8v-2h-8v2Zm0-5.5h8v-2h-8v2Zm0-5.5h8v-2h-8v2Z"
                    : "M5.5 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM8 6h13v1.5H8V6Zm-2.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM8 11.5h13V13H8v-1.5Zm-2.5 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM8 17h13v1.5H8V17Z"
                }
            />
        </svg>
    );
}

function refreshChannelView() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) {
        FluxDispatcher.dispatch({ type: "WINDOW_RESIZED" });
        return;
    }

    FluxDispatcher.dispatch({
        type: "CHANNEL_SELECT",
        channelId,
        guildId: SelectedGuildStore.getGuildId(),
    });
}

export function togglePanel(force?: boolean) {
    settings.store.panelOpen = force ?? !settings.store.panelOpen;
    refreshChannelView();
}

const TodoListToolbarButton = ErrorBoundary.wrap(() => {
    const { panelOpen } = settings.use(["panelOpen"]);

    return (
        <HeaderBarIcon
            className={cl("toolbox-btn")}
            onClick={() => togglePanel()}
            tooltip={panelOpen ? "Hide To-Do List" : "Show To-Do List"}
            icon={() => <TodoListIcon open={panelOpen} />}
            selected={panelOpen}
        />
    );
}, { noop: true });

export default definePlugin({
    name: "ToDoList",
    description: "Keeps a persistent colour-coded to-do list in a right sidebar, with optional channel links",
    tags: ["Utility", "Organisation"],
    authors: [Author],
    settings,

    patches: [
        {
            // Keep Discord's right sidebar slot open while To-Do is showing
            find: "{isSidebarVisible:",
            replacement: {
                match: /isSidebarVisible:(\i)/,
                replace: "isSidebarVisible:$self.isSidebarVisible($1)"
            }
        },
        {
            find: "Missing channel in Channel.renderHeaderToolbar",
            replacement: [
                {
                    // Put To-Do in the members/profile sidebar slot (hides those UIs)
                    match: /(?<=renderSidebar\(\){)/,
                    replace: "if($self.isPanelOpen())return $self.renderPanel();"
                },
                {
                    // Channel header toolbar button (call / pin / members row)
                    match: /(renderHeaderToolbar(?:",|=)\(\)=>{.{0,250}?let )(\i)(=\[\];)/,
                    replace: "$1$2$3$self.addToolbarButton($2);"
                }
            ]
        }
    ],

    // If the user toggles Discord's members/profile button, close To-Do
    // so the two modes stay mutually exclusive.
    flux: {
        CHANNEL_TOGGLE_MEMBERS_SECTION() {
            if (settings.store.panelOpen) {
                settings.store.panelOpen = false;
            }
        }
    },

    isPanelOpen: () => settings.store.panelOpen,

    isSidebarVisible(original: boolean) {
        return settings.store.panelOpen || original;
    },

    addToolbarButton(buttons: any[]) {
        buttons.push(<TodoListToolbarButton key="vc-todolist-toolbar-btn" />);
    },

    renderPanel: ErrorBoundary.wrap(() => (
        <div className={cl("host")}>
            <TodoPanel />
        </div>
    ), { noop: true }),

    start() {
        if (settings.store.openByDefault) {
            settings.store.panelOpen = true;
        }
    }
});
