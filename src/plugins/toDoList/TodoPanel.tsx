/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { DeleteIcon } from "@components/Icons";
import {
    ChannelRouter,
    ChannelStore,
    Clickable,
    GuildStore,
    ScrollerThin,
    SelectedChannelStore,
    SelectedGuildStore,
    Tooltip,
    useEffect,
    useState,
    useStateFromStores
} from "@webpack/common";
import type { InputHTMLAttributes } from "react";

import { cl, settings, TODO_COLORS, TodoColor, TodoItem } from ".";

function updateTodos(updater: (todos: TodoItem[]) => TodoItem[]) {
    settings.store.todos = updater(settings.store.todos ?? []);
}

function TodoInput(props: InputHTMLAttributes<HTMLInputElement>) {
    return <input {...props} className={cl("input", props.className)} />;
}

function getChannelLabel(channelId?: string | null) {
    if (!channelId) return null;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return { name: "Unknown channel", guildName: null as string | null, exists: false };

    if (channel.isDM()) {
        return { name: channel.rawRecipients?.[0]?.username ?? "Direct Message", guildName: null, exists: true };
    }

    if (channel.isGroupDM()) {
        return { name: channel.name || "Group DM", guildName: null, exists: true };
    }

    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    return {
        name: channel.name ? `#${channel.name}` : `#${channelId}`,
        guildName: guild?.name ?? null,
        exists: true
    };
}

function ColorSwatches({
    value,
    onChange
}: {
    value: TodoColor;
    onChange(color: TodoColor): void;
}) {
    return (
        <div className={cl("swatches")}>
            {TODO_COLORS.map(color => (
                <Tooltip key={color.id} text={color.label}>
                    {props => (
                        <button
                            {...props}
                            type="button"
                            className={cl("swatch", {
                                "swatch-selected": value === color.value,
                                "swatch-default": color.value == null
                            })}
                            style={color.value ? { backgroundColor: color.value } : undefined}
                            onClick={() => onChange(color.value)}
                            aria-label={color.label}
                        />
                    )}
                </Tooltip>
            ))}
        </div>
    );
}

function ChannelChip({ channelId }: { channelId?: string | null; }) {
    const label = getChannelLabel(channelId);
    if (!channelId || !label) return null;

    return (
        <div className={cl("channel-chip", { "channel-chip-missing": !label.exists })}>
            <Clickable
                className={cl("channel-chip-main")}
                onClick={() => {
                    if (label.exists) ChannelRouter.transitionToChannel(channelId);
                }}
            >
                <svg className={cl("channel-chip-icon")} width="12" height="12" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M5.887 21a.5.5 0 0 1-.442-.763L8.045 14H3.5a.5.5 0 0 1-.379-.828l8.5-9.5A.5.5 0 0 1 12.5 4v6.5h4.955a.5.5 0 0 1 .379.828l-8.5 9.5A.5.5 0 0 1 5.887 21Z" />
                </svg>
                <span className={cl("channel-chip-name")} title={label.guildName ? `${label.guildName} · ${label.name}` : label.name}>
                    {label.name}
                </span>
            </Clickable>
        </div>
    );
}

function TodoCheck({
    checked,
    color,
    onChange
}: {
    checked: boolean;
    color?: TodoColor;
    onChange(): void;
}) {
    return (
        <button
            type="button"
            className={cl("check", { "check-on": checked })}
            style={color ? { borderColor: color, backgroundColor: checked ? color : "transparent" } : undefined}
            onClick={onChange}
            aria-pressed={checked}
            aria-label={checked ? "Mark incomplete" : "Mark complete"}
        >
            {checked && (
                <svg width="12" height="12" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M9.8 17.3 4.5 12l1.4-1.4 3.9 3.9 8.3-8.3L19.5 8l-9.7 9.3Z" />
                </svg>
            )}
        </button>
    );
}

export function TodoPanel() {
    const { todos, linkCurrentChannelByDefault } = settings.use([
        "todos",
        "linkCurrentChannelByDefault"
    ]);
    const currentChannelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const currentGuildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());

    const [draft, setDraft] = useState("");
    const [draftColor, setDraftColor] = useState<TodoColor>(null);
    const [linkChannel, setLinkChannel] = useState(linkCurrentChannelByDefault);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState("");

    const items = todos ?? [];
    const remaining = items.filter(t => !t.completed).length;
    const completed = items.length - remaining;

    useEffect(() => {
        setLinkChannel(linkCurrentChannelByDefault);
    }, [linkCurrentChannelByDefault]);

    function addTodo() {
        const text = draft.trim();
        if (!text) return;

        updateTodos(list => [
            {
                id: crypto.randomUUID(),
                text,
                completed: false,
                createdAt: Date.now(),
                color: draftColor,
                channelId: linkChannel ? currentChannelId : null,
                guildId: linkChannel ? currentGuildId : null
            },
            ...list
        ]);
        setDraft("");
    }

    function patchTodo(id: string, patch: Partial<TodoItem>) {
        updateTodos(list => list.map(item => item.id === id ? { ...item, ...patch } : item));
    }

    function toggleTodo(id: string) {
        updateTodos(list => list.map(item =>
            item.id === id ? { ...item, completed: !item.completed } : item
        ));
    }

    function deleteTodo(id: string) {
        updateTodos(list => list.filter(item => item.id !== id));
        if (editingId === id) {
            setEditingId(null);
            setEditText("");
        }
    }

    function startEdit(item: TodoItem) {
        setEditingId(item.id);
        setEditText(item.text);
    }

    function saveEdit() {
        if (!editingId) return;
        const text = editText.trim();
        if (!text) {
            deleteTodo(editingId);
            return;
        }

        patchTodo(editingId, { text });
        setEditingId(null);
        setEditText("");
    }

    function clearCompleted() {
        updateTodos(list => list.filter(item => !item.completed));
    }

    function cycleColor(item: TodoItem) {
        const idx = TODO_COLORS.findIndex(c => c.value === (item.color ?? null));
        const next = TODO_COLORS[(idx + 1) % TODO_COLORS.length];
        patchTodo(item.id, { color: next.value });
    }

    function toggleItemChannel(item: TodoItem) {
        if (item.channelId) {
            patchTodo(item.id, { channelId: null, guildId: null });
            return;
        }

        patchTodo(item.id, {
            channelId: currentChannelId ?? null,
            guildId: currentGuildId ?? null
        });
    }

    const currentLabel = getChannelLabel(currentChannelId);

    return (
        <aside className={cl("panel")} aria-label="To-Do List">
            <div className={cl("header")}>
                <div>
                    <div className={cl("eyebrow")}>Personal</div>
                    <h2 className={cl("title")}>To-Do</h2>
                </div>
                <span className={cl("count")}>{remaining} left</span>
            </div>

            <div className={cl("composer")}>
                <TodoInput
                    placeholder="Add a task..."
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addTodo();
                        }
                    }}
                />

                <div className={cl("composer-row")}>
                    <ColorSwatches value={draftColor} onChange={setDraftColor} />
                    <Button size="small" onClick={addTodo} disabled={!draft.trim()}>
                        Add
                    </Button>
                </div>

                <div className={cl("composer-row")}>
                    <Tooltip text={linkChannel ? "New tasks will link to this channel" : "New tasks will not be linked"}>
                        {props => (
                            <button
                                {...props}
                                type="button"
                                className={cl("link-toggle", { "link-toggle-on": linkChannel })}
                                onClick={() => setLinkChannel(v => !v)}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24">
                                    <path fill="currentColor" d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a2.982 2.982 0 0 0 0-4.24 2.982 2.982 0 0 0-4.24 0l-3.53 3.53a2.982 2.982 0 0 0 0 4.24zm2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0 5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.43l-.47.47a2.982 2.982 0 0 0 0 4.24 2.982 2.982 0 0 0 4.24 0l3.53-3.53a2.982 2.982 0 0 0 0-4.24.973.973 0 0 1 0-1.42z" />
                                </svg>
                                {linkChannel ? "Link channel" : "No channel"}
                            </button>
                        )}
                    </Tooltip>
                    {linkChannel && currentLabel && (
                        <span className={cl("composer-channel")} title={currentLabel.guildName ?? undefined}>
                            {currentLabel.name}
                        </span>
                    )}
                </div>
            </div>

            <ScrollerThin className={cl("scroller")} fade>
                {items.length === 0
                    ? (
                        <div className={cl("empty")}>
                            <div className={cl("empty-title")}>Nothing here yet</div>
                            <div className={cl("empty-text")}>Add a task, pick a colour, and optionally link it to a channel.</div>
                        </div>
                    )
                    : items.map(item => (
                        <div
                            key={item.id}
                            className={cl("item", { "item-done": item.completed })}
                            style={item.color ? { ["--vc-todolist-accent" as string]: item.color } : undefined}
                        >
                            <div className={cl("item-accent")} />
                            <TodoCheck
                                checked={item.completed}
                                color={item.color}
                                onChange={() => toggleTodo(item.id)}
                            />

                            <div className={cl("item-body")}>
                                {editingId === item.id
                                    ? (
                                        <TodoInput
                                            value={editText}
                                            onChange={e => setEditText(e.target.value)}
                                            autoFocus
                                            onKeyDown={e => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    saveEdit();
                                                } else if (e.key === "Escape") {
                                                    setEditingId(null);
                                                    setEditText("");
                                                }
                                            }}
                                            onBlur={saveEdit}
                                        />
                                    )
                                    : (
                                        <Clickable onClick={() => startEdit(item)}>
                                            <div className={cl("item-text", { "item-text-done": item.completed })}>
                                                {item.text}
                                            </div>
                                        </Clickable>
                                    )}

                                {item.channelId && (
                                    <ChannelChip channelId={item.channelId} />
                                )}
                            </div>

                            <div className={cl("item-actions")}>
                                <Tooltip text="Cycle colour">
                                    {props => (
                                        <button
                                            {...props}
                                            type="button"
                                            className={cl("icon-btn")}
                                            onClick={() => cycleColor(item)}
                                        >
                                            <span
                                                className={cl("color-dot", { "color-dot-default": !item.color })}
                                                style={item.color ? { backgroundColor: item.color } : undefined}
                                            />
                                        </button>
                                    )}
                                </Tooltip>
                                <Tooltip text={item.channelId ? "Unlink channel" : "Link current channel"}>
                                    {props => (
                                        <button
                                            {...props}
                                            type="button"
                                            className={cl("icon-btn", { "icon-btn-active": !!item.channelId })}
                                            onClick={() => toggleItemChannel(item)}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24">
                                                <path fill="currentColor" d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82.12 1.64.4 2.43l-.47.47a2.982 2.982 0 0 0 0 4.24 2.982 2.982 0 0 0 4.24 0l3.53-3.53a2.982 2.982 0 0 0 0-4.24.973.973 0 0 1 0-1.42z" />
                                            </svg>
                                        </button>
                                    )}
                                </Tooltip>
                                <Tooltip text="Delete">
                                    {props => (
                                        <button
                                            {...props}
                                            type="button"
                                            className={cl("icon-btn", "icon-btn-danger")}
                                            onClick={() => deleteTodo(item.id)}
                                        >
                                            <DeleteIcon width={16} height={16} />
                                        </button>
                                    )}
                                </Tooltip>
                            </div>
                        </div>
                    ))}
            </ScrollerThin>

            <div className={cl("footer")}>
                <span className={cl("footer-text")}>
                    {items.length} total{completed > 0 ? ` · ${completed} done` : ""}
                </span>
                {completed > 0 && (
                    <Button size="small" variant="secondary" onClick={clearCompleted}>
                        Clear done
                    </Button>
                )}
            </div>
        </aside>
    );
}
