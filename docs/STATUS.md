# POMAK — status rada

**Aktuelno: 15.11.2026. — spremno za zatvoreno testiranje, ne još za javnu Play Store objavu.**

## Aktuelno stanje

- Web PWA i Django API su objavljeni na Vercelu; poslednji produkcioni auth-fix je merge #19 (commit `f43b72c`).
- Prijava i registracija koriste web HttpOnly refresh cookie, a Android koristi native Keystore; migracije naloga i rad bez interneta imaju regresione testove.
- CI proverava Django, frontend testove/build/lint i Android debug APK. APK još treba ručno testirati na telefonu.
- Personalni treninzi, rutine, dnevnik hrane, recepti, ciljevi, napredak, trener/klijent, izvoz i brisanje naloga postoje.
- QA prijavio 81/81 API i 33/33 Chrome provera (eksterni izveštaj; nezavisna ručna end-to-end verifikacija nije obavljena u ovom PR-u).
- Turnstile login-recovery je implementiran, ali je produkcioni feature flag namerno isključen dok se ne potvrdi E2E ponašanje.
- `CRON_SECRET` postoji u Vercel produkcionom projektu (vrednost nije u repozitorijumu); uspeh svakog dnevnog izvođenja se proverava zasebno.
- Zaštićena API identifikacija IP-ja testirana je na QA sa direktnom i rewrite putanjom; WAF zaštita od distribuiranog napada i dalje je operativni zadatak.

## Blokatori za javno objavljivanje

1. **Nalog:** korisnički tok za resetovanje lozinke, promenu lozinke i potvrdu email adrese, uz ispravno podešen email servis, testove i rollout.
2. **Privatnost:** javna politika privatnosti, uslovi korišćenja i dosledna Google Play Data Safety deklaracija. Ne objavljivati pravne tekstove bez verifikacije odgovornog lica.
3. **Android:** originalna ikona/splash, potpisani release AAB (ključ van Git-a), closed-track test na fizičkom telefonu.
4. **Hosting:** komercijalna upotreba zahteva odgovarajući Vercel plan i proveru Neon kvota/cena.
5. **Ishrana:** stručna revizija `msj-v1` procene i ograničenja pre javnih preporuka (videti `KALORIJSKI_METOD.md`).

## Manji poslovi

- Produkcioni error monitoring, zaštita Django admin prijave i operativni WAF/cron audit.
- Preostali dizajn/UX detalji i dodatno mobilno testiranje.
- U aktuelnoj radnoj grani uvode se korekcija formata trenerovih serija i uređivanje sopstvenih namirnica kroz UI.

---

## Istorijski zapis: stanje 30.09.2026.

*Tekst ispod je arhivski presek razvoja, a ne aktuelna lista urađenih i neurađenih zadataka. Za današnje stanje koristi odeljke iznad.*

## Gde smo

Faza 1 (lična aplikacija), urađeni koraci:

| Korak | Šta radi | Provereno |
|---|---|---|
| 1.0 | Kostur: Django + Postgres, prijava (JWT), React sa 5 sekcija, Capacitor APK | emulator |
| 1.0b | Registracija kao korisnik ili trener; početno podešavanje u 3 koraka (šta pratiš, pol/datum rođenja/visina/težina, iskustvo i broj treninga) | emulator |
| 1.1 | Biblioteka od 53 vežbe (pretraga bez kvačica i na engleskom), lične vežbe, rutine (pravljenje, izmena, kopija, brisanje) | emulator |
| 1.1b | Dva jezika: srpski (latinica) i engleski — ekrani, poruke servera, nazivi vežbi, brojevi i datumi | emulator |
| 1.2a | Aktivan trening: prošli rezultat uz svaku seriju, potvrda serije, tajmer pauze + Android obaveštenje, kraj treninga (sažetak, utisak, komentar), čuvanje na telefonu (preživi gašenje aplikacije), slanje bez duplikata, istorija | emulator |
| 1.2b | Red za slanje: završen trening ide u red na telefonu i šalje se sam (pokretanje, povratak interneta, povratak iz pozadine, na 60 s); novi trening ga ne dira; lokalni podaci vezani za nalog (upozorenje pri odjavi); aplikacija radi bez interneta od pokretanja; detalj treninga iz istorije; „Tačna obaveštenja za pauzu“ u Profilu | emulator |
| 1.3 | Baza namirnica: 122 namirnice iz USDA FoodData Central (svaka vrednost ima USDA ID za proveru) sa srpskim/engleskim nazivima i porcijama („1 jaje“, „1 kašika“); lične namirnice sa deklaracije (nepoznato ostaje „?“, ne 0); pretraga bez kvačica; preračun na zadatu količinu | emulator |
| 1.4a | Dnevnik hrane: doručak/ručak/večera/užina, unos iz namirnice (količina ili porcija) ili ručni unos (poznate kcal, nepoznati makroi ostaju „?“), izmena i brisanje, snimak vrednosti pri unosu (AC-04), zbir dana sa označenim nepoznatim vrednostima (AC-05), status dana (u toku / kompletan / nepotpun), rad bez interneta (izmene se šalju same), „Nedavno“ radi i bez interneta | emulator |
| 1.4b | Brži unos: sačuvani obroci (iz obroka u dnevniku, dodaju se odjednom, brisanje ne menja dnevnik), „Kopiraj od juče“ za obrok (ne menja status dana), podešavanje obroka u Profilu (nazivi, do 6 obroka, čuva se na nalogu); ispravljeno osvežavanje prijave za čuvanje profila | emulator |

| 1.4c | Recepti: sastojci iz baze, masa gotovog jela (ili zbir sastojaka) i broj porcija; vrednosti na 100 g i „1 porcija“ računa server, pregled uživo pri pravljenju; recept se traži i upisuje u dnevnik kao namirnica; izmena recepta ne menja upisane obroke (AC-04); nepoznata vrednost sastojka ostaje nepoznata (AC-05); izmena lične namirnice preračunava recepte | emulator |
| 1.5 | Kalorijski cilj: predlog aplikacije (`msj-v1`, proračun korak po korak pre prihvatanja, podaci iz profila i poslednjeg merenja) ili moj cilj; nepodržan profil (godine, posebna stanja, ispod donje granice) ne dobija automatski predlog (AC-06); jedan cilj po datumu, novi važi od danas ili kasnije, raniji dani zadržavaju svoj (AC-07); dnevnik prikazuje cilj i koliko je ostalo, neutralno | emulator |
| 1.6a | Napredak: telesna težina sa grafikonom; merenja (težina i obimi) — unos, grafikon, lista, brisanje; vežbe koje si radio; po vežbi lični rekordi (najveća težina, procenjeni 1RM po Epley-u, obim serije i treninga, ponavljanja, trajanje, distanca; zagrevanje se ne računa), grafikon po treningu i istorija serija | emulator |
| 1.6b | Ciljevi napretka (težina, obimi ili broj treninga nedeljno; polazna vrednost iz poslednjeg merenja, stanje i traka napretka, poslednje 4 nedelje; ostvaren / prekinut bira korisnik; jedan aktivan po vrsti) i nedeljni pregled (treninzi prema cilju, prosek kalorija i makroa samo iz kompletnih dana uz „Kompletno X od 7 dana“ i oznaku za nepoznate vrednosti — AC-05, promena težine) | emulator |
| 1.7 | Danas: sledeći trening (rutina posle poslednje odrađene) sa „Počni“, treninzi ove nedelje, ishrana danas prema cilju, brz upis težine; izvoz svih podataka (ZIP: pomak.json + CSV za treninge, ishranu, merenja; na telefonu Android meni za deljenje); brisanje naloga uz lozinku (briše sve lične podatke); Profil: „Šta pratiš“, link na kalorijski cilj | emulator |
| 1.7 UX | Pregled svih ekrana: trajanje treninga „7 min“ umesto „0:07“, isti naziv „Slobodan trening“, kalorije u listama kao ceo broj, porcija „1 jaje (veliko) · 50 g“, kraće „1 bez podatka“, jasniji status kompletnog dana, objašnjenje praznog naziva obroka, „Dodaj u dnevnik (danas)“ sa detalja namirnice (obrok prema dobu dana), jasniji cilj treninga, dugme `danger` i mala veličina dugmeta | emulator |
| 1.7b | Crteži vežbi: 42 od 53 vežbe iz biblioteke imaju crtež početnog i završnog položaja (Everkinetic, CC BY-SA 4.0, bez izmena, svako uparivanje vizuelno provereno; rade i bez interneta). Sličica u izboru vežbi, rutini, aktivnom treningu, istoriji i napretku; dodir otvara panel sa animiranim crtežom, mišićem i opremom. Vežbe bez crteža i lične vežbe imaju ujednačenu ikonicu. Autorstvo u panelu i u Profilu → Izvori podataka | emulator |
| 1.7c | Uputstva za svih 53 vežbe iz biblioteke, na srpskom i engleskom (sopstveni tekst: 3–5 koraka + savet; `backend/training/data/instructions.py`); prikaz u panelu vežbe („Kako se radi“, numerisani koraci, izdvojen savet) i na ekranu napretka (sklopivo); jezik prati aplikaciju | emulator |
| 1.7d | Jezik: globus sa oznakom (SR/EN) u zaglavlju svih glavnih ekrana, na prijavi/registraciji i u početnom podešavanju; meni sa nazivima jezika na svom jeziku; trenutna promena uz kratku potvrdu, pamti se na nalogu; u Profilu red „Jezik · Srpski ›“. Ispravljeno: podaci učitani na prethodnom jeziku (nazivi vežbi) se osvežavaju kad se jezik preuzme sa naloga; ključevi za trajanje treninga. Novi test: svaki ključ prevoda iz koda postoji na oba jezika | emulator |
Testovi: backend 99, frontend 92 — svi prolaze.

## Sledeći korak: objavljivanje (kad korisnik odobri) i sitnice

Faza 1 je funkcionalno gotova. Pre objavljivanja:
1. **Deploy** (Render/Vercel/Neon) — samo uz odobrenje korisnika.
2. **Ikona i splash ekran POMAK** za APK (sada je podrazumevana Capacitor ikona).
3. **Izmena lične namirnice** (sada postoji samo brisanje; API za izmenu već postoji).
4. Istorija treninga sa servera dostupna i bez interneta; premeštanje vežbi tokom treninga.
5. Crteži za preostalih 11 vežbi (kardio, plank, face pull...); uputstva bi trebalo da pregleda trener.

## Ideje za dalje (dogovoreno kao diskusija, 30. 9. 2026. — još ništa nije rađeno)

Predloženi redosled (korisnik bira kad nastavimo):
1. **Zdrav opseg težine** (BMI 18,5–24,9, SZO) + **odnos struk/visina < 0,5** (NICE 2022) + **ciljna težina sa procenom trajanja** pri izabranom tempu. Bez jednog „idealnog“ broja (stare formule Devine/Robinson/Miller su nepouzdane); ne za < 18 god., trudnoću, posebna stanja.
2. **Skener barkoda** (Capacitor ML Kit, radi bez interneta): naša baza → Open Food Facts (ODbL: navesti izvor, izvedena baza ostaje otvorena; ~5.000 proizvoda za Srbiju) → ako nema, unos sa deklaracije i čuvanje sa barkodom. Pre odluke: praktično proveriti 20–30 proizvoda iz lokalnih prodavnica. Kasnije: čitanje tabele sa slike deklaracije. Besplatno (MyFitnessPal ga naplaćuje od 2022).
3. **„Šta ti fali danas“** (npr. još 60 g proteina) sa predlozima iz korisnikovih namirnica i recepata — ne gotovi jelovnici (to je posao nutricioniste/trenera).
4. **Pametno prilagođavanje cilja** (kao MacroFactor): stvarna potrošnja iz unosa i trenda težine, nedeljni predlog korekcije — samo iz kompletnih dana; granice mora da proveri stručnjak.

**Pre objavljivanja:** kalorijski metod `msj-v1` treba da pregleda stručnjak — `docs/KALORIJSKI_METOD.md`.

Posle 1.6: 1.7 Danas ekran + izvoz + deploy.

## Baza namirnica — kako se ažurira

Izbor je u `backend/nutrition/data/usda_selection.py`. Posle izmene: preuzmi SR Legacy CSV sa
https://fdc.nal.usda.gov/download-datasets, pa `python nutrition/data/build_usda_foods.py <folder>`
i nova migracija koja učitava `usda_foods.json` (vrednosti se nikad ne unose ručno).

## Poznata ograničenja (namerno odloženo)

- Kartica „Sledeći trening“ na ekranu Danas još ne predlaže rutinu (korak 1.7).
- Nema promene redosleda vežbi tokom treninga (u rutini postoji).
- Istorija sa servera se ne vidi kad je aplikacija pokrenuta bez interneta (vide se samo treninzi koji čekaju slanje). Rešenje kasnije: čuvanje keša upita na telefonu.
- Aplikacija ima podrazumevanu Capacitor ikonicu; POMAK ikonicu i početni ekran napraviti pre objavljivanja.
- Emulator na ovom računaru: pokretati sa `-gpu swiftshader_indirect`, inače je prozor crn.
- [Istorijski zapis 30.09] Kod tada nije bio u Git repozitorijumu; danas je objavljen.

## Kako nastaviti (za sledeću sesiju)

```bash
docker compose up -d db                                   # baza
cd backend && source venv/Scripts/activate && python manage.py runserver 0.0.0.0:8001
cd frontend && npm run dev                                # http://localhost:5173
```

Nalozi za probu (lokalna baza): `test@pomak.rs` i `trener@pomak.rs`, lozinka `test-lozinka-123`.

Emulator: Android Studio → Device Manager → **Pixel_7**. Ako je ekran crn posle pokretanja,
sačekaj 30–60 s (prvo pokretanje učitava snimak stanja) ili izaberi *Cold Boot Now*.
