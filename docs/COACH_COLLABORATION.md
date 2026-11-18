# POMAK: saradnja trenera i klijenta

Trenerski prostor (Pregled, Klijenti, Programi, Poruke), odluke i faze T1–T4: `COACH_WORKSPACE.md`.

## Korisnički tok

1. Registruj trenera (tip naloga **Trener sam**) i odgovori na početna pitanja. U delu **Klijenti** napravi pozivnicu (važi 7 dana, može da se poništi): kod, link ili QR kod.
2. Klijent otvara link ili na svojoj kartici **Trener** unosi kod, pa vidi ko je trener pre nego što prihvati. Odgovori „Kako si danas?“ (spremnost) dele se samo uz posebnu dozvolu. Prihvatom deli istoriju treninga i nedeljne ciljeve; telesna merenja/ciljevi obima i zbir kalorija/makroa za poslednjih 7 dana dele se **samo uz posebno odobrenje**.
3. Trener na listi svojih klijenata može da pogleda skorašnje treninge i dozvoljene podatke, pošalje poruku i **dodeli kopiju svoje rutine** koristeći vežbe iz zajedničke biblioteke.
4. Klijent dobija rutinu u svom nalogu, na kartici Trening, i može da je izmeni/odradi. Posle prekida saradnje rutina ostaje njegova; trener više nema pristup njegovim podacima, a razgovor ostaje obema stranama samo za čitanje.
5. Klijent može u bilo kom trenutku promeniti izbor deljenja ili prekinuti saradnju. Trener takođe može ukloniti klijenta.

## API

Svi endpointi zahtevaju JWT; uloge, vlasništvo, aktivna veza i consent proveravaju se na **serveru pri svakom zahtevu**.

- `GET /api/coach/dashboard/` — trener: klijenti/pozivnice; klijent: njegova veza i dodeljene rutine
- `POST /api/coach/invitations/`, `DELETE /api/coach/invitations/{id}/` — trener
- `POST /api/coach/connect/` `{code,share_measurements,share_nutrition}` — klijent
- `PATCH /api/coach/connection/`, `DELETE /api/coach/connection/` — klijent
- `GET /api/coach/clients/{client_id}/`, `DELETE /api/coach/clients/{client_id}/` — njegov trener
- `POST /api/coach/clients/{client_id}/assign/` `{routine_id}` — trener, kopira **samo javne vežbe**
- `GET|POST /api/coach/messages/` — aktivna veza; trener daje `client_id`, klijent ne; `connection_id` čita i arhivirani razgovor (slanje u završenu saradnju: 409)
- `GET|PUT /api/coach/profile/` — trener: profil i početna pitanja (`complete: true`)
- `GET /api/coach/invitations/preview/?code=` — karta trenera za važeći kod, pre prihvatanja
- `PATCH /api/coach/clients/{client_id}/` `{status: active|paused}` — njegov trener
- `GET /api/coach/tasks/`, `PATCH /api/coach/tasks/{id}/` `{action: done|reopen|snooze, days}` — trener
- `GET /api/coach/conversations/` — svi razgovori korisnika, aktivni pa arhivirani
- `GET|POST /api/coach/connections/{id}/notes/`, `PATCH|DELETE /api/coach/notes/{id}/` — beleške; klijent dobija samo deljene

## Ograničenja namerno ostavljena za buduće faze

- Nema rasporeda/termina i kalendarskih rezervacija (T4), grupnih trenera ni naplate.
- Nema push notifikacija (T3); razgovor se osvežava svakih 15 sekundi dok je ekran otvoren.
- Jedan klijent može imati samo jednog povezanog trenera. Korisnik sa trenerskom ulogom ne koristi i klijentsku vezu.
- Trener ne dobija pristup podacima pre prihvatanja pozivnice. Klijent ne daje treneru pravo direktnog upisa rezultata, obroka ili merenja.
- Dodela kopira rutinu. Dalje izmene originalne trenerove rutine ne menjaju kopiju kod klijenta.
- Prekid veze ne briše ništa: saradnja ostaje arhivirana (razgovor i beleške samo za čitanje); već kopirane rutine ostaju korisniku.

## Bezbedan deployment

1. CI: Django testovi na izolovanoj PostgreSQL bazi i React build moraju proći.
2. Na produkcionoj Neon bazi pokreni **jednokratno** `python manage.py migrate --noinput` pre puštanja novih API ruta, bez brisanja postojećih zapisa.
3. Ukloni jednokratnu migracionu komandu iz Vercel Build Command.
4. Merge u `main`, proveri Vercel frontend/backend `READY` i probaj: trener napravi kod → klijent prihvati → trener dodeli rutinu → klijent vidi rutinu → poruka u oba smera → promena deljenja → prekid veze → 404 za stari trenerov pristup.
