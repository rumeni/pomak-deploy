# POMAK

**Tvoj trening. Tvoja ishrana. Tvoj napredak.**

POMAK je aplikacija za praćenje treninga i ishrane, sa opcionom saradnjom sa trenerom. Jedan kod radi kao
veb aplikacija (PWA) i kao Android aplikacija (Capacitor), na srpskom (latinica) i engleskom, i bez interneta.

> *EN: POMAK is a workout and nutrition tracker with optional coach collaboration — a React PWA packaged
> as an Android app via Capacitor, backed by Django REST Framework. Bilingual (Serbian / English), offline-first.*

**Status:** faza 1 (lični deo aplikacije) je funkcionalno gotova; deo za trenera dolazi u sledećim fazama.
Detalji: [`docs/STATUS.md`](docs/STATUS.md) · plan i model podataka: [`docs/PLAN_FAZA_1.md`](docs/PLAN_FAZA_1.md)

## Mogućnosti

**Trening**
- Biblioteka od 53 vežbe sa crtežima položaja i uputstvima (srpski i engleski), pretraga bez kvačica, lične vežbe
- Rutine: pravljenje, izmena, kopija, brisanje
- Aktivan trening: prošli rezultat uz svaku seriju, tajmer pauze sa Android obaveštenjem, sažetak na kraju
- Trening se čuva na telefonu (preživi gašenje aplikacije) i šalje se sam kad se internet vrati, bez duplikata

**Ishrana**
- Baza od 122 namirnice iz USDA FoodData Central (svaka vrednost ima USDA ID) + lične namirnice sa deklaracije
- Dnevnik po obrocima, zbir i status dana; nepoznata vrednost ostaje „?“, nikad 0
- Sačuvani obroci, „Kopiraj od juče“, recepti (vrednosti se računaju iz sastojaka i mase gotovog jela)
- Kalorijski cilj: predlog sa objašnjenjem proračuna ili sopstveni cilj ([metod](docs/KALORIJSKI_METOD.md) čeka stručnu proveru)

**Napredak**
- Lični rekordi i grafikon po vežbi, telesna težina i obimi, ciljevi, nedeljni pregled
- Ekran „Danas“: sledeći trening, ishrana prema cilju, brz upis težine

**Nalog i podaci**
- Registracija kao korisnik ili trener, početno podešavanje u 3 koraka
- Izvoz svih podataka (ZIP: JSON + CSV) i brisanje naloga

## Tehnologije

| Deo | Tehnologija |
|---|---|
| Backend | Python, Django 6, Django REST Framework, SimpleJWT, PostgreSQL |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, i18next, Dexie (IndexedDB), PWA |
| Android | Capacitor 8 (isti React kod upakovan u APK), lokalna obaveštenja |

## Struktura

```
backend/
  config/      podešavanja, rute
  core/        zajednički model (UUID), pretraga bez kvačica, idempotentno kreiranje, test runner
  accounts/    nalog, profil, prijava, izvoz podataka
  training/    vežbe, rutine, odrađeni treninzi
  nutrition/   namirnice, dnevnik, recepti, kalorijski cilj; data/ = USDA izbor i skripta za uvoz
  progress/    merenja i ciljevi napretka
  locale/      srpski prevodi serverskih poruka
frontend/
  src/app/        rute i raspored
  src/features/   ekrani po sekcijama (auth, training, workout, diary, nutrition, progress, today…)
  src/i18n/       tekstovi: sr.ts i en.ts
  src/lib/        API, prijava, lokalna baza, formatiranje brojeva i datuma
  android/        Capacitor Android projekat
docs/             status, plan, kalorijski metod
```

## Deployment: Vercel Hobby + Neon Free

Pripremljena su dva Vercel projekta iz istog GitHub repozitorijuma (`frontend` Vite i `backend` Django) i Neon PostgreSQL Free baza. Koraci, obavezne environment varijable, migracije i provere opisani su u [**DEPLOY_VERCEL_NEON.md**](docs/DEPLOY_VERCEL_NEON.md).

**Važno:** Hobby je za nekomercijalnu upotrebu; besplatne kvote nisu garancija neograničenog hostinga. Kod je namenjen objavljivanju uz saglasnost originalnog autora. Ne commitovati tajne.

## Pokretanje lokalno

Potrebno: Python 3.12+, Node.js 22+, Docker Desktop (za bazu).
Portovi: backend **8001**, baza **5433** (mogu se promeniti u `docker-compose.yml` i `.env`).

### 1. Baza

```bash
docker compose up -d db
```

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/Scripts/activate    # Linux/macOS: source venv/bin/activate · PowerShell: venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env            # pa upiši svoj SECRET_KEY
python manage.py migrate        # pravi tabele i učitava vežbe i namirnice
python manage.py createsuperuser   # opciono, za /admin
python manage.py runserver 0.0.0.0:8001
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.development.local   # adresa backend API-ja
npm install
npm run dev                     # http://localhost:5173
```

## Testovi

```bash
cd backend && python manage.py test
cd frontend && npm test
cd frontend && npm run build    # provera tipova + build
```

## Prevodi (srpski / engleski)

- **Tekst u aplikaciji:** svaki tekst ide preko ključa u `frontend/src/i18n/sr.ts` i `en.ts`.
  Testovi proveravaju da oba fajla imaju iste ključeve i promenljive i da svaki ključ korišćen u kodu (`t('...')`) postoji.
- **Poruke servera:** engleski tekst u kodu (`_('...')`), srpski u `backend/locale/translations_sr.py`. Posle izmene
  (potrebni su GNU gettext alati):

  ```bash
  cd backend
  python manage.py makemessages -l sr_Latn --ignore=venv --no-location
  python locale/fill_po.py
  python manage.py compilemessages --ignore=venv
  ```

## Android APK (debug)

Telefon ili emulator i računar moraju biti u istoj mreži. U `frontend/.env.development.local` upiši IP računara:

```env
VITE_API_URL=http://192.168.1.90:8001/api
```

i dodaj taj IP u `ALLOWED_HOSTS` u `backend/.env` (pa restartuj backend). Zatim:

```bash
cd frontend
npx vite build --mode development
CAP_DEV=1 npx cap sync android
cd android
./gradlew assembleDebug         # potreban JDK 21 (npr. onaj iz Android Studija)
```

APK: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

- Debug APK sme da koristi `http` ka računaru; release verzija radi samo preko `https`.
- Ako telefon ne dolazi do backend-a, proveri da firewall dozvoljava port 8001.
- Ako je prozor emulatora crn, pokreni ga sa `-gpu swiftshader_indirect`.

## Izvori podataka

- **Namirnice:** [USDA FoodData Central](https://fdc.nal.usda.gov/) (SR Legacy), javno dobro.
  Kako se baza ažurira: [`docs/STATUS.md`](docs/STATUS.md#baza-namirnica--kako-se-ažurira).
- **Crteži vežbi:** [Everkinetic](https://github.com/everkinetic/data), licenca CC BY-SA 4.0, bez izmena —
  [`frontend/public/exercises/README.md`](frontend/public/exercises/README.md).
- **Uputstva za vežbe:** sopstveni tekst (`backend/training/data/instructions.py`).
