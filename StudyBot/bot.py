from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)
from database import get_user, save_lesson, set_premium

TOKEN = "7581522285:AAFx5VdFf1XDDJRDEu4gdzAt6OBKCdFpwr0"

LESSONS = {
    1: "📘 Lección 1 (GRATIS)\nHello = Hola",
    2: "📗 Lección 2 (PREMIUM)\nGoodbye = Adiós",
    3: "📙 Lección 3 (PREMIUM)\nPlease = Por favor",
}

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    lesson, premium = get_user(user_id)
    await send_lesson(update, context, lesson, premium)

async def send_lesson(update, context, lesson_number, premium):
    if lesson_number > 1 and not premium:
        text = (
            "🔒 Contenido Premium\n\n"
            "Para acceder a todas las lecciones:\n"
            "💳 Pago por Yape / Plin\n"
            "📩 Escribe /premium"
        )
        reply_markup = None
    else:
        text = LESSONS.get(lesson_number, "🎉 Curso terminado")
        keyboard = []
        if lesson_number < len(LESSONS):
            keyboard.append(
                [InlineKeyboardButton("➡️ Siguiente", callback_data="next")]
            )
        reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None

    if update.message:
        await update.message.reply_text(text, reply_markup=reply_markup)
    else:
        await update.callback_query.edit_message_text(
            text=text, reply_markup=reply_markup
        )

async def next_lesson(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id

    lesson, premium = get_user(user_id)
    lesson += 1
    save_lesson(user_id, lesson)

    await send_lesson(update, context, lesson, premium)

async def premium_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "💎 StudyPlus Premium\n\n"
        "Acceso total a todas las lecciones.\n\n"
        "📲 Pago:\n"
        "Yape / Plin: 900 000 000\n\n"
        "Luego del pago, escribe:\n"
        "/activar"
    )

async def activar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    set_premium(user_id)
    await update.message.reply_text("✅ Premium activado. Disfruta el curso 🎉")

def main():
    print("🤖 StudyPlus PREMIUM iniciado...")
    app = Application.builder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("premium", premium_info))
    app.add_handler(CommandHandler("activar", activar))
    app.add_handler(CallbackQueryHandler(next_lesson, pattern="next"))

    app.run_polling()

if __name__ == "__main__":
    main()




