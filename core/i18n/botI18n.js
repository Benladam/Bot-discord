/**
 * botI18n.js — Traductions des messages du bot (côté Discord/terminal).
 * Même 4 langues que le GUI : fr, en, es, ar.
 * Sert aux messages génériques du bot (aide, erreurs, /call, statut…).
 * Les commandes musicales gardent leurs propres embeds pour l'instant.
 */
const STR = {
  fr: {
    helpTitle: '📖 Commandes du bot',
    unknown: 'Commande inconnue',
    errPrefix: 'Erreur',
    callRepost: (name, body) => `${name} : ${body}`,
    callDeleted: 'Message supprimé et republié par le bot.',
    statusSet: (t) => `🎧 Activité : « Écoute ${t} »`,
    linkOnlyOwner: '🔒 Cette commande est réservée au propriétaire du bot.',
    linkTitle: '🔗 Lien de configuration',
    linkOpen: (url) => `Ouvre le panneau de contrôle : ${url}`,
    langSetPersonal: (l) => `🌐 Langue personnelle définie sur « ${l} ».`,
    langSetServer: (l) => `🌍 Langue du serveur forcée sur « ${l} » (irrévocable par un utilisateur).`,
    langUnknown: (l) => `Langue « ${l} » non supportée. Langues : fr, en, es, ar.`,
    langList: 'Langues disponibles : fr (français), en (english), es (español), ar (العربية).',
    modeMusicOnly: '🎵 Mode : musique uniquement (commandes d’administration désactivées).',
    modeAdminOnly: '🛡️ Mode : administration uniquement (musique désactivée).',
    modeAll: '🌟 Mode : tout (musique + administration).',
    discordOffline: 'Discord hors-ligne — fonctionnalités du bot limitées au panneau.',
    promo: 'Bot créé avec le panneau Heuss. Rejoins le support : ',
  },
  en: {
    helpTitle: '📖 Bot commands',
    unknown: 'Unknown command',
    errPrefix: 'Error',
    callRepost: (name, body) => `${name} : ${body}`,
    callDeleted: 'Message deleted and reposted by the bot.',
    statusSet: (t) => `🎧 Activity: "Listening to ${t}"`,
    linkOnlyOwner: '🔒 This command is reserved for the bot owner.',
    linkTitle: '🔗 Configuration link',
    linkOpen: (url) => `Open the control panel: ${url}`,
    langSetPersonal: (l) => `🌐 Personal language set to "${l}".`,
    langSetServer: (l) => `🌍 Server language forced to "${l}" (cannot be changed by a user).`,
    langUnknown: (l) => `Language "${l}" not supported. Languages: fr, en, es, ar.`,
    langList: 'Available languages: fr (français), en (english), es (español), ar (العربية).',
    modeMusicOnly: '🎵 Mode: music only (admin commands disabled).',
    modeAdminOnly: '🛡️ Mode: admin only (music disabled).',
    modeAll: '🌟 Mode: all (music + admin).',
    discordOffline: 'Discord offline — bot features limited to the panel.',
    promo: 'Bot built with the Heuss panel. Join support: ',
  },
  es: {
    helpTitle: '📖 Comandos del bot',
    unknown: 'Comando desconocido',
    errPrefix: 'Error',
    callRepost: (name, body) => `${name} : ${body}`,
    callDeleted: 'Mensaje eliminado y republicado por el bot.',
    statusSet: (t) => `🎧 Actividad: "Escuchando ${t}"`,
    linkOnlyOwner: '🔒 Este comando es solo para el dueño del bot.',
    linkTitle: '🔗 Enlace de configuración',
    linkOpen: (url) => `Abre el panel de control: ${url}`,
    langSetPersonal: (l) => `🌐 Idioma personal fijado en "${l}".`,
    langSetServer: (l) => `🌍 Idioma del servidor forzado a "${l}" (irrevocable por un usuario).`,
    langUnknown: (l) => `Idioma "${l}" no soportado. Idiomas: fr, en, es, ar.`,
    langList: 'Idiomas disponibles: fr (français), en (english), es (español), ar (العربية).',
    modeMusicOnly: '🎵 Modo: solo música (comandos de admin desactivados).',
    modeAdminOnly: '🛡️ Modo: solo admin (música desactivada).',
    modeAll: '🌟 Modo: todo (música + admin).',
    discordOffline: 'Discord desconectado — funciones del bot limitadas al panel.',
    promo: 'Bot creado con el panel Heuss. Únete al soporte: ',
  },
  ar: {
    helpTitle: '📖 أوامر البوت',
    unknown: 'أمر غير معروف',
    errPrefix: 'خطأ',
    callRepost: (name, body) => `${name} : ${body}`,
    callDeleted: 'تم حذف الرسالة وإعادة نشرها بواسطة البوت.',
    statusSet: (t) => `🎧 النشاط: "يستمع إلى ${t}"`,
    linkOnlyOwner: '🔒 هذا الأمر مخصص لمالك البوت فقط.',
    linkTitle: '🔗 رابط الإعداد',
    linkOpen: (url) => `افتح لوحة التحكم: ${url}`,
    langSetPersonal: (l) => `🌐 تم تعيين اللغة الشخصية إلى "${l}".`,
    langSetServer: (l) => `🌍 تم فرض لغة الخادم إلى "${l}" (لا يمكن للمستخدم تغييرها).`,
    langUnknown: (l) => `اللغة "${l}" غير مدعومة. اللغات: fr, en, es, ar.`,
    langList: 'اللغات المتاحة: fr (فرنسي), en (إنجليزي), es (إسباني), ar (عربي).',
    modeMusicOnly: '🎵 الوضع: موسيقى فقط (أوامر الإدارة معطلة).',
    modeAdminOnly: '🛡️ الوضع: إدارة فقط (الموسيقى معطلة).',
    modeAll: '🌟 الوضع: الكل (موسيقى + إدارة).',
    discordOffline: 'ديسكورد غير متصل — ميزات البوت محدودة باللوحة.',
    promo: 'تم إنشاء البوت عبر لوحة Heuss. انضم للدعم: ',
  },
};

const LANGS = ['fr', 'en', 'es', 'ar'];

/** Renvoie l'objet de traduction pour une langue (fr par défaut). */
function t(lang) {
  return STR[LANGS.includes(lang) ? lang : 'fr'];
}

module.exports = { STR, LANGS, t };
