/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { writeFile } from "fs/promises";

// Sibling repo on disk — not part of this Vencord checkout. Hardcoded and
// non-parameterized on purpose: this native.ts runs trusted Electron
// main-process code with real fs access, so the write target must not be
// something the renderer/plugin side can redirect.
const USERS_JSON_PATH = "/Users/jamessells/Documents/GitHub/valley-support/users.json";

export async function writeAllowlist(_: unknown, userIds: string[]): Promise<number> {
    await writeFile(USERS_JSON_PATH, JSON.stringify(userIds, null, 2) + "\n", "utf-8");
    return userIds.length;
}
