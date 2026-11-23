# Allaah's Beautiful Names Memorizer

A study site for memorizing the 104 Names explained in *A Summarized Explanation of Allaah's Beautiful Names*
by Shaykh 'AbdurRazzaaq al-Badr (translated by Umm 'AbdirRahmaan Tara Hashim).

**Live site:** https://acesuu.github.io/beautiful-names/

## Features
- Choose how many Names to memorize per day; daily plan adapts when you change it
- Study cards: Arabic, meaning, key points, evidence, practice questions and full chapter text
- Self-test flashcards, spaced-repetition review, and quizzes
- Progress tracker: memorized count, streak, 14-day history, estimated finish date
- Sign in with Google to save progress in the cloud (Firebase Auth + Firestore) and sync across devices
- Works without an account too (progress saved in the browser)

## Project layout
| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app (plain HTML/CSS/JS, no build step) |
| `cloud.js` | Google sign-in and Firestore sync |
| `firebase-config.js` | Firebase web config (public by design) |
| `firestore.rules` | Security rules: each user can only access their own document |
| `data/chapters/chNN.json` | Structured content per chapter |
| `data.js` | Generated from the chapter files by `python build_data.py` |

## Editing content
Edit a file in `data/chapters/`, then run `python build_data.py` to regenerate `data.js`.
