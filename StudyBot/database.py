import sqlite3

conn = sqlite3.connect("studyplus.db", check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER PRIMARY KEY,
    lesson INTEGER,
    premium INTEGER DEFAULT 0
)
""")

conn.commit()

def get_user(user_id):
    cursor.execute(
        "SELECT lesson, premium FROM progress WHERE user_id = ?",
        (user_id,),
    )
    row = cursor.fetchone()
    if row:
        return row[0], row[1]
    else:
        cursor.execute(
            "INSERT INTO progress (user_id, lesson, premium) VALUES (?, ?, ?)",
            (user_id, 1, 0),
        )
        conn.commit()
        return 1, 0

def save_lesson(user_id, lesson):
    cursor.execute(
        "UPDATE progress SET lesson = ? WHERE user_id = ?",
        (lesson, user_id),
    )
    conn.commit()

def set_premium(user_id):
    cursor.execute(
        "UPDATE progress SET premium = 1 WHERE user_id = ?",
        (user_id,),
    )
    conn.commit()

