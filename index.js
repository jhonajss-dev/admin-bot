import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { CONFIG } from "./config.js";
import { canRunCommand, getUserRole } from "./roles.js";
import {
  addTempBan,
  formatRemaining,
  getActiveBan,
  getExpiredBans,
  loadData,
  parseDurationToMs,
  removeMod,
  removeTempBan,
  removeUserRole,
  saveData,
  saveMod,
  setUserRole,
} from "./storage.js";

function normalizeJid(jid = "") {
  return jid.split(":")[0] + (jid.includes("@") ? "" : "@s.whatsapp.net");
}

function getKnownOwnerIds() {
  const data = loadData();
  const savedIds = Array.isArray(data.ownerIds) ? data.ownerIds : [];
  const extraOwners = Array.isArray(CONFIG.ownerJids) ? CONFIG.ownerJids : [];
  return new Set([CONFIG.ownerJid, ...extraOwners, ...savedIds].filter(Boolean));
}

function rememberOwnerId(jid) {
  if (!jid) return;
  const data = loadData();
  if (!Array.isArray(data.ownerIds)) data.ownerIds = [];
  if (!data.ownerIds.includes(jid) && jid !== CONFIG.ownerJid) {
    data.ownerIds.push(jid);
    saveData(data);
  }
}

function isOwnerSender(msg, senderJid) {
  const ownerNumber = CONFIG.ownerJid.split("@")[0];
  const senderNumber = senderJid.split("@")[0];
  const altJid = normalizeJid(msg.key.participantAlt || msg.key.remoteJidAlt || "");
  const altNumber = altJid.split("@")[0];
  const knownOwners = getKnownOwnerIds();

  const directMatch =
    knownOwners.has(senderJid) ||
    (altJid && knownOwners.has(altJid)) ||
    (ownerNumber && (senderNumber === ownerNumber || altNumber === ownerNumber));

  if (directMatch) {
    if (senderJid && senderJid !== CONFIG.ownerJid) {
      rememberOwnerId(senderJid);
    }
    if (altJid && altJid !== CONFIG.ownerJid) {
      rememberOwnerId(altJid);
    }
    return true;
  }

  return false;
}

function extractTargetUser(msg, args = []) {
  const quotedUser = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

  if (quotedUser) return normalizeJid(quotedUser);
  if (mentioned[0]) return normalizeJid(mentioned[0]);

  for (const arg of args) {
    const clean = arg.replace(/\D/g, "");
    if (clean.length >= 8) {
      return `${clean}@s.whatsapp.net`;
    }
  }

  return null;
}

async function checkBotIsAdmin(sock, chatId) {
  try {
    const metadata = await sock.groupMetadata(chatId);
    const botJid = normalizeJid(sock.user?.id || "");
    const botLid = normalizeJid(sock.user?.lid || sock.authState?.creds?.me?.lid || "");
    const botNumber = botJid.split("@")[0];
    const botLidNumber = botLid.split("@")[0];

    const botParticipant = metadata.participants.find((p) => {
      const pId = normalizeJid(p.id || "");
      const pJid = normalizeJid(p.jid || "");
      const pLid = normalizeJid(p.lid || "");
      const pPhone = (p.phoneNumber || "").replace(/\D/g, "");

      return (
        (botJid && (pId === botJid || pJid === botJid)) ||
        (botLid && (pId === botLid || pLid === botLid)) ||
        (botNumber && (pId.split("@")[0] === botNumber || pPhone === botNumber)) ||
        (botLidNumber && (pId.split("@")[0] === botLidNumber || pLid.split("@")[0] === botLidNumber))
      );
    });

    return (
      botParticipant?.admin === "admin" ||
      botParticipant?.admin === "superadmin"
    );
  } catch (err) {
    console.error("Error obteniendo metadata del grupo:", err);
    return false;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });

  sock.ev.on("creds.update", saveCreds);

  // Revisa cada 60s bans vencidos para limpiarlos
  const banWatcher = setInterval(() => {
    try {
      const expired = getExpiredBans();
      for (const item of expired) {
        console.log(
          `Ban temporal expirado: ${item.userJid} en grupo ${item.groupId}`
        );
      }
    } catch (err) {
      console.error("Error en banWatcher:", err);
    }
  }, 60 * 1000);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("Escanea este QR con el número secundario de WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Bot conectado correctamente.");
    }

    if (connection === "close") {
      clearInterval(banWatcher);
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "desconocido";
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `Conexión cerrada (código: ${statusCode ?? "N/A"} | motivo: ${reason}). Reconectando:`,
        shouldReconnect
      );

      if (shouldReconnect) {
        setTimeout(() => startBot(), 2000);
      }
    }
  });

  // Protección anti-demote para el owner + re-expulsión si reentra estando baneado
  sock.ev.on("group-participants.update", async ({ id, participants, action, author }) => {
    if (!id.endsWith("@g.us")) return;

    try {
      const botJid = normalizeJid(sock.user?.id);
      const authorJid = normalizeJid(author);
      const knownOwners = getKnownOwnerIds();

      if (
        action === "demote" &&
        participants.some((p) => knownOwners.has(normalizeJid(p))) &&
        authorJid !== botJid &&
        !knownOwners.has(authorJid)
      ) {
        await sock.groupParticipantsUpdate(id, [CONFIG.ownerJid], "promote");
        await sock.sendMessage(id, {
          text: "No se puede quitar el rango de administrador al dueño.",
        });
      }

      if (action === "add") {
        for (const participant of participants) {
          const targetJid = normalizeJid(participant);
          const activeBan = getActiveBan(id, targetJid);
          if (activeBan) {
            await sock.groupParticipantsUpdate(id, [targetJid], "remove");
            await sock.sendMessage(id, {
              text: `@${targetJid.split("@")[0]} sigue con ban temporal (restante: ${formatRemaining(activeBan.expiresAt)}).`,
              mentions: [targetJid],
            });
          }
        }
      }
    } catch (err) {
      console.error("Error en group-participants.update:", err);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages?.[0];
      if (!msg?.message || msg.key.fromMe) return;

      const chatId = msg.key.remoteJid;
      if (!chatId || !chatId.endsWith("@g.us")) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      if (!text.startsWith(CONFIG.prefix)) return;

      const [rawCmd, ...args] = text.slice(CONFIG.prefix.length).trim().split(/\s+/);
      const command = (rawCmd || "").toLowerCase();

      const rawSender = msg.key.participant || msg.key.remoteJid || "";
      const senderJid = normalizeJid(rawSender);
      const ownerMatch = isOwnerSender(msg, senderJid);

      console.log(
        "DEBUG sender:",
        rawSender,
        "| norm:",
        senderJid,
        "| alt:",
        msg.key.participantAlt || msg.key.remoteJidAlt || "-",
        "| isOwner:",
        ownerMatch
      );

      if (!ownerMatch && !canRunCommand(senderJid, command)) {
        await sock.sendMessage(chatId, {
          text: "No tienes permiso para usar este comando.",
        });
        return;
      }

      if (command === "ping") {
        await sock.sendMessage(chatId, {
          text: `Activo | Tu rol: ${ownerMatch ? "owner" : getUserRole(senderJid)}`,
        });
        return;
      }

      if (command === "info") {
        const currentRole = ownerMatch ? "owner" : getUserRole(senderJid);
        await sock.sendMessage(chatId, {
          text: `Usuario: @${senderJid.split("@")[0]}\nRol actual: ${currentRole}`,
          mentions: [senderJid],
        });
        return;
      }

      if (command === "setrole") {
        const validRoles = ["vip", "mod", "subowner"];
        const targetRole = (args[0] || "").toLowerCase();
        const rawTarget = extractTargetUser(msg, args.slice(1));

        if (!validRoles.includes(targetRole) || !rawTarget) {
          await sock.sendMessage(chatId, {
            text: "Uso: .setrole <vip|mod|subowner> @usuario (o respondiendo a su mensaje).",
          });
          return;
        }

        setUserRole(rawTarget, targetRole);
        await sock.sendMessage(chatId, {
          text: `Rol *${targetRole}* asignado a @${rawTarget.split("@")[0]}.`,
          mentions: [rawTarget],
        });
        return;
      }

      if (command === "delrole") {
        const rawTarget = extractTargetUser(msg, args);
        if (!rawTarget) {
          await sock.sendMessage(chatId, {
            text: "Menciona, responde o pasa el número al que quieres quitarle el rol.",
          });
          return;
        }

        removeUserRole(rawTarget);
        await sock.sendMessage(chatId, {
          text: `Rol restablecido a *member* para @${rawTarget.split("@")[0]}.`,
          mentions: [rawTarget],
        });
        return;
      }

      if (command === "setmod") {
        const rawTarget = extractTargetUser(msg, args);
        if (!rawTarget) {
          await sock.sendMessage(chatId, {
            text: "Responde al mensaje, menciona a un usuario o pasa su número.",
          });
          return;
        }

        saveMod(rawTarget);
        await sock.sendMessage(chatId, {
          text: `Moderador guardado: @${rawTarget.split("@")[0]}`,
          mentions: [rawTarget],
        });
        return;
      }

      if (command === "delmod") {
        const rawTarget = extractTargetUser(msg, args);
        if (!rawTarget) {
          await sock.sendMessage(chatId, {
            text: "Responde al mensaje, menciona o pasa el número del mod a quitar.",
          });
          return;
        }

        removeMod(rawTarget);
        await sock.sendMessage(chatId, {
          text: `Moderador eliminado: @${rawTarget.split("@")[0]}`,
          mentions: [rawTarget],
        });
        return;
      }

      const botIsAdmin = await checkBotIsAdmin(sock, chatId);
      if (!botIsAdmin) {
        await sock.sendMessage(chatId, {
          text: "Necesito ser administrador del grupo para ejecutar esta acción.",
        });
        return;
      }

      const botJid = normalizeJid(sock.user?.id);

      if (command === "cerrar") {
        await sock.groupSettingUpdate(chatId, "announcement");
        await sock.sendMessage(chatId, {
          text: "Grupo cerrado: solo administradores.",
        });
      } else if (command === "abrir") {
        await sock.groupSettingUpdate(chatId, "not_announcement");
        await sock.sendMessage(chatId, {
          text: "Grupo abierto: todos pueden escribir.",
        });
      } else if (command === "kick") {
        const target = extractTargetUser(msg, args);
        if (!target) {
          await sock.sendMessage(chatId, {
            text: "Responde al mensaje o menciona a quien deseas expulsar.",
          });
          return;
        }

        if (target === CONFIG.ownerJid || target === botJid) {
          await sock.sendMessage(chatId, {
            text: "No puedo expulsar a este usuario.",
          });
          return;
        }

        await sock.groupParticipantsUpdate(chatId, [target], "remove");
      } else if (command === "tban") {
        const durationArg = args[0] || "";
        const durationMs = parseDurationToMs(durationArg);
        const target = extractTargetUser(msg, args.slice(1));

        if (!durationMs || !target) {
          await sock.sendMessage(chatId, {
            text: "Uso: .tban <10s|15m|2h|1d> @usuario [motivo] (o respondiendo a su mensaje).",
          });
          return;
        }

        if (target === CONFIG.ownerJid || target === botJid) {
          await sock.sendMessage(chatId, {
            text: "No puedo banear a este usuario.",
          });
          return;
        }

        const reason =
          args
            .slice(1)
            .filter((a) => !a.startsWith("@") && !/^\d{8,}$/.test(a.replace(/\D/g, "")))
            .join(" ") || "Sin motivo";

        const banRecord = addTempBan(chatId, target, durationMs, reason);
        await sock.groupParticipantsUpdate(chatId, [target], "remove");
        await sock.sendMessage(chatId, {
          text: `Usuario @${target.split("@")[0]} baneado por *${durationArg}*.\nMotivo: ${reason}\nTiempo restante: ${formatRemaining(banRecord.expiresAt)}`,
          mentions: [target],
        });
      } else if (command === "unban") {
        const target = extractTargetUser(msg, args);
        if (!target) {
          await sock.sendMessage(chatId, {
            text: "Uso: .unban @usuario o .unban 519XXXXXXXX",
          });
          return;
        }

        const removed = removeTempBan(chatId, target);
        await sock.sendMessage(chatId, {
          text: removed
            ? `Ban retirado para @${target.split("@")[0]}. Ya puede reingresar.`
            : `El usuario @${target.split("@")[0]} no tenía un ban activo en este grupo.`,
          mentions: [target],
        });
      }
    } catch (err) {
      console.error("Error en messages.upsert:", err);
    }
  });
}

startBot();