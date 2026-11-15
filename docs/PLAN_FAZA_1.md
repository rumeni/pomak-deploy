# POMAK — plan faze 1 (lična aplikacija)

Izvor zahteva: `POMAK_Specifikacija_aplikacije_za_Claude.pdf` (v1.0). Ovaj dokument beleži
**odluke** i **redosled rada** za fazu 1. Cilj faze: sve upotrebljivo bez trenera (AC-01).

Oznake: ✅ urađeno · 🔜 sledeće · ⏳ kasnije u fazi 1

---

## 1. Odluke (faza 0)

| Tema | Odluka | Zašto |
|---|---|---|
| Platforma | React veb aplikacija (PWA) + **Capacitor** za Android APK, jedan kod | Veb je prvi, trener radi na širem ekranu, offline logika se piše jednom |
| Backend | Django 6 + DRF + SimpleJWT | Isto kao Paws, poznato |
| Baza | PostgreSQL (lokalno Docker na portu 5433, produkcija Neon) | Ograničenja za termine, pretraga |
| Hosting | Render (API), Vercel (veb), Cloudinary (slike, kasnije) | Isto kao Paws |
| Frontend | React 19, Vite, TypeScript, Tailwind 4, TanStack Query, React Hook Form + Zod | Isto kao Paws veb |
| Offline | IndexedDB (Dexie) + red za slanje; ID pravi klijent (UUID) | AC-02: bez gubitka i bez duplikata |
| Namirnice | USDA FoodData Central (osnovne, CC0) + Open Food Facts (upakovani, ODbL) + lične | Nema otvorene srpske baze; izvor se prikazuje uz namirnicu |
| Kalorije | Metod `msj-v1` (vidi §5), **čeka stručnu proveru** | Spec traži dokumentovan i proveren metod |

## 2. Arhitektura

```
frontend/ (React)                         backend/ (Django)
  src/app        rute, raspored            config/     podešavanja
  src/features   ekrani po sekcijama       core/       zajednički model (UUID, vremena), pretraga
  src/lib        api, auth, db, sync       accounts/   nalog, profil, prijava
  src/components zajednički UI             training/   vežbe, rutine, sesije         🔜
  android/       Capacitor projekat        nutrition/  namirnice, obroci, ciljevi    ⏳
                                           progress/   merenja, ciljevi              ⏳
```

Pravila koja važe za ceo kod:
- **Dva jezika.** Svaki tekst na ekranu ide preko ključa u `frontend/src/i18n/sr.ts` i `en.ts` (test proverava da su isti). Serverske poruke: engleski u kodu, srpski u `backend/locale/translations_sr.py`.
- **Istorija se ne prepisuje.** Sesija čuva plan kakav je bio pri početku; unos hrane čuva nutritivne
  vrednosti iz trenutka unosa; cilj ima datum od kog važi.
- **Nepoznato nije nula.** Nepoznati makroi su `null`, a ne 0.
- **Autor izmene.** Svaka izmena rezultata beleži ko ju je napravio (priprema za trenera u fazi 2).
- **Idempotentno slanje.** Klijent šalje `PUT /…/{uuid}/`; ponovljeno slanje istog zapisa ne pravi duplikat.
- **Konflikt ne prepisuje tiho.** Zapisi imaju `version`; zastarela izmena dobija 409 i korisnik bira.

## 3. Model podataka faze 1

| Entitet | Ključna polja |
|---|---|
| User / Profile ✅ (uloga trenera: `is_coach`) | email, ime, šta prati, iskustvo, nedeljni cilj treninga, pol/datum rođenja/visina (samo za ishranu) |
| Exercise ✅ | naziv, alternativni nazivi, `search_name`, oprema, tip merenja (težina+pon., sopstvena težina, dodatna/asistirana, trajanje, distanca), težina po komadu/ukupno, vlasnik (`null` = zajednička) |
| Routine / RoutineExercise / RoutineSet ✅ | naziv, redosled vežbi, planirane serije (pon. od–do, težina), pauza, beleška |
| WorkoutSession | izvor (rutina/slobodan), `plan_snapshot` (JSON), početak/kraj, status, utisak, komentar, `version` |
| SetLog | vežba, redni broj, tip (zagrevanje/radna), težina, pon., trajanje, distanca, potvrđena, autor, `version` |
| Food | izvor (USDA/OFF/lični), naziv, `search_name`, vrednosti na 100 g (kcal, P, UH, M — mogu biti `null`), porcije |
| Recipe / RecipeVersion | sastojci, ukupna masa ili broj porcija |
| MealEntry | dan, obrok, namirnica/recept, količina, **snimak** vrednosti |
| NutritionDay | datum, status: u toku / kompletan / nepotpun |
| NutritionTargetVersion | važi od, kcal i makroi, metod + ulazi, autor, način vođenja |
| Measurement ✅ | datum, tip (težina, obim…), vrednost |
| Goal | tip, polazna i ciljna vrednost, period, status |

## 4. Ekrani faze 1

- **Prijava / registracija / početak** ✅ (izbor: trening, ishrana ili oba)
- **Danas**: sledeći trening, ishrana danas, nedeljni broj treninga
- **Trening**: moje rutine → uređivanje rutine → **aktivan trening** (prošli rezultat uz unos, potvrda serije, tajmer pauze, obaveštenje kad je pauza gotova) → sažetak → istorija
- **Ishrana**: dnevnik po obrocima → pretraga / nedavno / ručni unos → recepti → kalorijski cilj
- **Napredak**: istorija vežbe i rekordi, telesna težina i merenja, ciljevi, nedeljni pregled
- **Profil**: podaci, šta pratim, izvoz podataka, brisanje naloga

## 5. Kalorijski metod `msj-v1` (predlog, čeka stručnu proveru — detalji i izvori: `docs/KALORIJSKI_METOD.md`)

1. BMR = Mifflin-St Jeor: `10·kg + 6,25·cm − 5·godine + 5` (M) / `− 161` (Ž).
2. Potrošnja = BMR × faktor aktivnosti (1,2–1,9), faktor **uključuje** planirane treninge. Kalorije sa treninga se nikad ne dodaju na cilj.
3. Tempo: % telesne težine nedeljno. Mršavljenje 0,25–1 %, dobijanje 0,1–0,5 %. Pretvaranje ~7.700 kcal/kg.
4. Donja granica 1.200 kcal (Ž) / 1.500 kcal (M): ispod toga nema automatske preporuke.
5. Proteini 1,4–2,0 g/kg (ISSN); masti i UH po izboru korisnika iz ostatka.
6. Podržani: 18+, bez trudnoće, dojenja i prijavljenih zdravstvenih stanja. Ostali dobijaju „Moj cilj“ ili trenera (AC-06).
7. Čuvaju se ulazi, verzija metoda i datum (AC-07).

## 6. Redosled rada

| Korak | Sadržaj | Kriterijumi |
|---|---|---|
| 1.0 ✅ | Kostur: repo, Django + Postgres, prijava (JWT), React sa 5 tabova, početak, Capacitor + debug APK | — |
| 1.0b ✅ | Uloga na registraciji (korisnik / trener), početno podešavanje u 3 koraka: šta pratiš, telesni podaci (pol, datum rođenja, visina, težina kao merenje), iskustvo i broj treninga | — |
| 1.1 ✅ | Biblioteka od 53 vežbe (pretraga bez kvačica i po engleskom nazivu), lične vežbe, rutine: pravljenje, izmena, kopija, brisanje (arhiviranje) | AC-01 |
| 1.1b ✅ | Dva jezika (srpski latinica / engleski): svi ekrani, poruke servera, nazivi vežbi, brojevi i datumi; jezik telefona pri prvom pokretanju, izbor na prijavi i u Profilu, pamti se na nalogu | AC-14 |
| 1.2a ✅ | Aktivan trening: start iz rutine ili prazan, prošli rezultat uz svaku seriju, potvrda serije (✓), tajmer pauze + Android obaveštenje, kraj treninga (sažetak, utisak, komentar), čuvanje na telefonu tokom treninga i posle gašenja aplikacije, slanje sa ID-jem (bez duplikata), istorija | AC-02, AC-03 |
| 1.2b ✅ | Red za slanje (neposlati treninzi posebno, novi trening ih ne dira), automatsko slanje, lokalni podaci vezani za nalog, rad bez interneta od pokretanja, detalj treninga, tačna obaveštenja u Profilu | AC-02 |
| 1.3 ✅ | Baza namirnica: 122 namirnice iz USDA FoodData Central (SR Legacy, CC0) sa srpskim i engleskim nazivima i porcijama, USDA ID uz svaku; lične namirnice (nepoznato = null); pretraga bez kvačica i na oba jezika; detalj sa preračunom na količinu | AC-04, AC-05, AC-14 |
| 1.4a ✅ | Dnevnik hrane: obroci, unos iz namirnice (količina ili porcija) i ručni unos, izmena i brisanje, snimak vrednosti pri unosu, zbir dana sa odvojeno označenim nepoznatim vrednostima, status dana, rad bez interneta (red izmena), nedavne namirnice | AC-04, AC-05, AC-14 |
| 1.4b ✅ | Sačuvani obroci, kopiranje obroka od juče, podešavanje naziva i broja obroka (do 6) | AC-04, AC-05 |
| 1.4c ✅ | Recepti (sastojci, ukupna masa / porcije), upis u dnevnik kao namirnica | AC-04, AC-05 |
| 1.5 ✅ | Kalorijski cilj `msj-v1` + istorija ciljeva | AC-06, AC-07 |
| 1.6a ✅ | Napredak: istorija vežbi i rekordi, težina i merenja sa grafikonom | AC-01 |
| 1.6b ✅ | Ciljevi napretka, nedeljni pregled (obuhvat podataka) | AC-01, AC-05 |
| 1.7 ✅ | Danas ekran, izvoz podataka, brisanje naloga, pregled i doterivanje svih ekrana | AC-14 |
| 1.8 🔜 | Deploy (Render/Vercel/Neon) — kad korisnik odobri; ikona i splash | — |

Posle svakog koraka: testovi na backend-u, provera u pregledaču i na telefonu (APK).
