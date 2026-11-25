import fs from "fs";
import path from "path";

const DATA_PATH = path.resolve("./data.json");

export function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    const initial = { mods: [], roles: {}, bans: {} };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      mods: Array.isArray(parsed.mods) ? parsed.mods : [],
      roles:
        parsed.roles && typeof parsed.roles === "object" ? parsed.roles : {},
      bans: parsed.bans && typeof parsed.bans === "object" ? parsed.bans : {},
    };
  } catch {
    return { mods: [], roles: {}, bans: {} };
  }
}

export function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

export function setUserRole(jid, role) {
  const data = loadData();
  data.roles[jid] = role;
  saveData(data);
  return data.roles;
}

export function removeUserRole(jid) {
  const data = loadData();
  delete data.roles[jid];
  data.mods = data.mods.filter((item) => item !== jid);
  saveData(data);
  return data.roles;
}

export function saveMod(jid) {
  const data = loadData();
  if (!data.mods.includes(jid)) {
    data.mods.push(jid);
  }
  data.roles[jid] = "mod";
  saveData(data);
  return data.mods;
}

export function removeMod(jid) {
  return removeUserRole(jid);
}

export function parseDurationToMs(input = "") {
  const match = input.trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2];
  if (value <= 0) return null;

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

export function addTempBan(groupId, userJid, durationMs, reason = "Sin motivo") {
  const data = loadData();
  if (!data.bans[groupId]) data.bans[groupId] = {};

  const now = Date.now();
  data.bans[groupId][userJid] = {
    bannedAt: now,
    expiresAt: now + durationMs,
    reason,
  };

  saveData(data);
  return data.bans[groupId][userJid];
}

export function removeTempBan(groupId, userJid) {
  const data = loadData();
  if (data.bans[groupId]?.[userJid]) {
    delete data.bans[groupId][userJid];
    if (Object.keys(data.bans[groupId]).length === 0) {
      delete data.bans[groupId];
    }
    saveData(data);
    return true;
  }
  return false;
}

export function getActiveBan(groupId, userJid) {
  const data = loadData();
  const ban = data.bans[groupId]?.[userJid];
  if (!ban) return null;

  if (Date.now() >= ban.expiresAt) {
    removeTempBan(groupId, userJid);
    return null;
  }

  return ban;
}

export function getExpiredBans() {
  const data = loadData();
  const now = Date.now();
  const expired = [];

  for (const [groupId, users] of Object.entries(data.bans)) {
    for (const [userJid, ban] of Object.entries(users)) {
      if (now >= ban.expiresAt) {
        expired.push({ groupId, userJid, ban });
        delete data.bans[groupId][userJid];
      }
    }
    if (Object.keys(data.bans[groupId] || {}).length === 0) {
      delete data.bans[groupId];
    }
  }

  if (expired.length > 0) {
    saveData(data);
  }

  return expired;
}

export function formatRemaining(expiresAt) {
  const diffMs = Math.max(0, expiresAt - Date.now());
  const totalSec = Math.ceil(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}