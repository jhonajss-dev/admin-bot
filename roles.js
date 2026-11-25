import { CONFIG } from "./config.js";
import { loadData } from "./storage.js";

export function getUserRole(jid) {
  if (jid === CONFIG.ownerJid) return "owner";
  const { mods } = loadData();
  if (mods.includes(jid)) return "mod";
  return "member";
}

export function canRunCommand(jid, command) {
  const required = CONFIG.commandRoles[command] || "owner";
  const role = getUserRole(jid);

  if (required === "all") return true;
  if (required === "mod") return role === "mod" || role === "owner";
  if (required === "owner") return role === "owner";

  return false;
}