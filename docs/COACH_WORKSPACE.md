# POMAK COACH: trenerski prostor (specifikacija i odluke)

Dopuna specifikacije (`POMAK_Specifikacija_aplikacije_za_Claude.pdf`, poglavlja 9–12) i predloga
`POMAK_COACH_Predlog.pdf`. Odluke su usvojene 18.11.2026. Gde se ovaj dokument razlikuje od
specifikacije, važi ovaj dokument. Tok saradnje (pozivnica, deljenje, prekid) i API opisani su u
`COACH_COLLABORATION.md`.

## Usvojene odluke

1. **Paketi treninga** ulaze u T4 kao evidencija uplaćenih, iskorišćenih i preostalih termina,
   bez online naplate.
2. **Zakazivanje (T4):** klijent odmah rezerviše slobodan termin koji je trener otvorio. Trener u
   podešavanjima bira automatsku ili ručnu potvrdu.
3. **Prekid saradnje:** razgovor ostaje arhiviran, samo za čitanje. Ništa se ne briše.
4. **„Nedelja“ (T2):** nedeljni izveštaj i check-in na jednom ekranu. Ekran je dostupan i
   korisnicima bez trenera.
5. **Spremnost:** prikazuje se procenat zajedno sa odgovorima koji su na njega uticali. Nema
   medicinskih zaključaka i nema automatske promene opterećenja.
6. **Posebna dozvola za spremnost.** Odgovori „Kako si danas?“ (san, stres, upala, motivacija)
   i procenat su subjektivni podaci o oporavku. Ne dele se uz istoriju treninga, već samo uz
   zasebnu dozvolu koju klijent može da povuče u bilo kom trenutku.
   - Podrazumevano je isključena, i za veze nastale pre ove izmene.
   - Povlačenje dozvole briše i već nastale zadatke o niskoj spremnosti, zajedno sa sačuvanim
     odgovorima.

## Trenerski prostor

- Uloga trenera se dodaje nalogu. Trener i dalje ima svoj trening i ishranu.
  - **Prekidač** „Trenerski deo / Moj trening“ je u gornjem uglu.
  - Aplikacija se otvara u prostoru koji je trener poslednji koristio.
- **Navigacija:** Pregled, Klijenti, Programi, Poruke. Kalendar se dodaje u T4. Prazne kartice
  se ne prikazuju.
- **Pregled je lista zadataka.**
  - Zadatak može da se završi, odloži (1, 3 ili 7 dana) ili ponovo otvori.
  - Isti događaj nikad ne pravi dva upozorenja.
  - Tekst je činjenica („Nema treninga 9 dana“), nikad zaključak o klijentu.
- **Statusi klijenata:** pozvan, aktivan, na pauzi, arhiviran. Klijent na pauzi ne pravi
  upozorenja o neaktivnosti.
- **Profil klijenta** ima kartice Pregled, Plan, Napredak, Ishrana i Beleške.
  - Podaci koje klijent ne deli prikazuju se kao „nije podeljeno“.
- **Beleške** su privatne (samo trener) ili vidljive klijentu. Razlika je jasno označena, a
  deljenje beleške se potvrđuje.
- **Računar:** od 980 px liste klijenata i razgovora su levo, a izabrani klijent ili razgovor
  desno.
- **Vizuelni identitet:** isti kao ostatak aplikacije. Trenerski deo je njen nastavak, ne
  poseban proizvod.

## Programi i saradnja (T2)

- Koristi se postojeći editor rutina.
- Dodela programa ima tri koraka: šablon, izbor klijenata, datum početka.
- Šablon i individualni plan klijenta su odvojeni. Promena šablona ne menja automatski
  postojeće planove.
- Izmene plana važe samo za buduće treninge. Započeti i završeni treninzi ostaju netaknuti.
- Komentar na trening i poruka su isti zapis (poruka vezana za trening), bez dupliranja.
- Klijent može u svakom trenutku da promeni deljenje ili prekine saradnju. Sve dozvole se
  proveravaju na serveru.

## Faze

| Faza | Sadržaj |
|---|---|
| **T1** | Trenerski prostor, profil i početna pitanja, navigacija, klijenti, pozivnice (kod, link, QR), zadaci, privatne beleške, arhiviranje razgovora |
| T2 | Programi, verzije planova, pregled treninga, komentari, napredak, ishrana, „Nedelja“ |
| T3 | Nepročitane poruke, push obaveštenja (Firebase i web push), slike, uputstva za vežbe, slika trenera |
| T4 | Kalendar, rezervacije (zaštita od duplih rezervacija u bazi), vrste termina, paketi, podsetnici |

Svaka faza ima zaseban PR sa testovima. Pre spajanja proveravaju se privatnost, Android i
desktop prikaz i rad bez interneta.

## T1: kako radi

### Početna pitanja i profil trenera

- **Kada:** pri prvom ulasku u trenerski deo, u tri kratka koraka:
  1. iskustvo i oblasti rada;
  2. gde i kako radi;
  3. kvalifikacije i opis (opciono).
- **Obavezno:** godine iskustva, bar jedna oblast i način rada. Za rad uživo obavezan je i grad.
- **Kvalifikacije** se klijentu prikazuju uz napomenu da ih je trener sam naveo i da ih POMAK ne
  proverava.
- **Slika trenera** dolazi u T3, zajedno sa čuvanjem fajlova. Do tada se prikazuju inicijali.

### Pozivnica

- **Napomena „za koga“** je opciona i vidi je samo trener. Ona čini status „pozvan“.
- **Kod, link i QR:**
  - pozivnica se šalje kao kod, link (`/povezi/KOD`) ili QR kod;
  - QR se crta u aplikaciji (biblioteka `@zxing/library`, koju već koristimo), bez spoljnog servisa;
  - link otvara web aplikaciju; Android aplikacija ga za sada ne presreće.
- **Pre prihvatanja** klijent vidi kartu trenera: ime, iskustvo, oblasti, teretanu i grad (sa
  linkom na mapu), opis i kvalifikacije. Email trenera se nikad ne prikazuje.
- **Bez prijave:** ako klijent otvori link neprijavljen, kod se pamti (samo u toj kartici
  pregledača) i koristi se posle prijave, odnosno registracije i početnog podešavanja.

### Zadaci na Pregledu

Zadaci nastaju iz podataka koje trener već sme da vidi, za treninge **završene tokom saradnje**:

| Zadatak | Kada | Ključ (jednom po događaju) |
|---|---|---|
| Završen trening | klijent je završio trening | trening |
| Niska spremnost | spremnost pred trening ispod 50 %, samo uz dozvolu za spremnost | trening |
| Lični rekord | procenjeni 1RM bolji od svih ranijih treninga (prvi put nije rekord) | trening |
| Nema treninga | 7 dana bez treninga (računa se od poslednjeg treninga ili od povezivanja/povratka sa pauze) | početak tog perioda |

- **Kada se računaju:** pri otvaranju Pregleda ili liste klijenata. Treninzi se pronalaze po
  vremenu kada su stigli na server, pa se računa i trening zabeležen bez interneta i poslat
  kasnije.
  - Kursor uvek ide napred (vreme, pa ID), pa ni mnogo treninga sačuvanih u istom trenutku ne
    može da ga zaglavi.
  - Odvojen, ograničen prolaz preko poslednjih 10 minuta hvata trening čija je transakcija
    završena posle neke kasnije.
- **Ispravka i brisanje treninga:** zadaci prate trening.
  - Kad klijent ispravi trening, zadaci dobijaju nove činjenice ili nestaju ako više ne važe.
    Trenerova radnja (završeno, odloženo) ostaje na zadatku koji i dalje važi.
  - Obrisan trening briše i svoje zadatke.
  - Lični rekordi su trenutne činjenice, ne snimak u trenutku otkrivanja. Ispravka ili brisanje
    treninga ponovo ocenjuje rekorde kasnijih treninga u oba smera: kasniji trening može da
    postane rekord ili da prestane da bude rekord.
  - Ponovo se ocenjuje najviše 100 najnovijih kasnijih treninga te saradnje. Starijim
    treninzima rekord ostaje kako je bio ocenjen.
- **Zaključavanje:** svako ko menja zadatke prvo zaključava saradnju i ponovo je čita. To važi
  za proveru novih treninga, usklađivanje, brisanje treninga, promenu dozvola, prekid i
  trenerovu radnju nad zadatkom. Zato provera koja je u toku ne može da upiše odgovore posle
  povlačenja dozvole ili posle prekida, niti da vrati zadatke obrisanog treninga.
  - Zadatak o spremnosti bez važeće dozvole ne postoji ni za čitanje ni za izmenu (404).
- **Duplikati:** sprečava ih jedinstveni ključ u bazi. Zato je provera bezbedna i kada se
  pokrene više puta istovremeno.
- **Upozorenje „nema treninga“** se samo zatvara kada klijent ponovo trenira ili ode na pauzu.
  Takav zadatak se ne prikazuje kao trenerov završen zadatak.

### Prekid saradnje

- Veza dobija datum završetka i ostaje kao arhiva.
- **Trener:**
  - odmah gubi pristup podacima klijenta;
  - zadržava razgovor i svoje beleške, samo za čitanje.
- **Klijent:**
  - zadržava razgovor i podeljene beleške, samo za čitanje;
  - zadržava i dodeljene rutine.
- Nove poruke i beleške, kao i izmena ili brisanje postojeće beleške, odbijaju se (409). Izmena
  beleške zaključava vezu pre beleške, pa ni prekid u istom trenutku ne može da promeni
  arhiviranu belešku.
- Zadaci te saradnje se brišu.
- **Ekran bivšeg trenera:** čim server odgovori da trener više nema pristup (401/403/404), podaci
  klijenta se brišu i iz keša u aplikaciji. Ne prikazuju se ni posle povratka na taj ekran, ni
  uz neku novu saradnju sa istim klijentom.
- **Šta trener vidi određuju podaci sa servera, ne redosled odgovora.**
  - **Šta šalje server:**
    - verziju pristupa uz svaku saradnju, koja raste sa svakom promenom deljenja i sa prekidom;
    - datum početka saradnje;
    - vreme kada je spisak klijenata bio tačan.
  - **Evidencija pristupa:** spisak klijenata i ekran klijenta upisuju šta su videli u jednu
    evidenciju za prijavljeni nalog. Ona čuva najvišu viđenu verziju po saradnji i nikad se ne
    vraća na stariju; svi ekrani i lista zadataka proveravaju prema njoj. Briše se pri odjavi.
  - **Pravila u aplikaciji:**
    - Saradnja koja je završena, zamenjena novijom ili je nema na spisku koji je noviji od nje:
      ništa se ne prikazuje ni bez interneta, a keš se briše. Takva saradnja se pamti kao
      ukinuta, pa je ni zakasneli odgovor ne vraća.
    - Ako je verzija pristupa promenjena (dozvola uzeta ili ponovo data), prikazuju se samo
      treninzi. Merenja, ishrana i spremnost čekaju novo učitavanje na trenutnoj verziji. Iz
      keša se brišu kategorije koje trenutne dozvole više ne pokrivaju, pa ih ponovo data
      dozvola ne otkriva iz starih podataka.
    - Zadaci se ocenjuju po saradnji i verziji pod kojom su pročitani. Zadatak o spremnosti
      pročitan na staroj verziji se ne prikazuje.
    - Spisak još nije učitan (npr. bez interneta od početka): prikazuje se poslednji učitani
      ekran, sa dozvolama sa kojima je učitan.
- Klijent kasnije može da se poveže ponovo, i sa istim trenerom. To je nova saradnja, a stara
  arhiva ostaje odvojena.
- U bazi važi pravilo da klijent ima najviše jednu aktivnu saradnju.

### Bez interneta

- Trenerski ekrani prikazuju poslednje učitane podatke, uz traku „Nema interneta…“.
- **Pristup koji je klijent ukinuo dok je trener bez interneta** ne može da se primeni trenutno:
  trener do ponovnog povezivanja vidi ono što je ranije učitao. Prvi odgovor servera posle
  povezivanja briše te podatke.
- Akcije trenera (zadatak, beleška, pozivnica, profil, poruka) traže vezu sa serverom.
  - Bez veze odmah javljaju „Nema veze sa serverom“.
  - Ne čekaju tiho u pozadini.

### Uvođenje na produkciju

- **Migracija:** `coaching.0002_coach_workspace` mora da se pokrene na produkciji:
  `python manage.py migrate`.
- **Šta migracija menja:** veza klijenta postaje „najviše jedna aktivna“ umesto „samo jedna“.
  Postojećim vezama se „aktivan od“ postavlja na datum povezivanja.
- **Starije Android verzije** rade i dalje: postojeća polja API odgovora nisu menjana, samo su
  dodata nova.

## T2a: programi i planovi

- **Program (šablon)** je raspored trenerovih rutina po danima u nedelji, sa trajanjem u nedeljama
  ili bez kraja. Koristi samo trenerove rutine sa vežbama iz zajedničke biblioteke, jer klijent
  ne vidi trenerove privatne vežbe.
- **Dodela u tri koraka:** program, klijenti, datum početka (danas ili kasnije).
  - Svaki klijent dobija plan od tog dana, sa svojim kopijama rutina. Kasnija izmena programa ne
    menja postojeće planove.
  - **Potvrda zahteva:** svaki zahtev (dodela ili izmena plana) ima ID i trajnu potvrdu po
    saradnji, odvojenu od verzija.
    - Ponovljen zahtev ne pravi ništa dvaput, ni kad je ponovljen samo za deo klijenata, ni posle
      datuma početka.
    - Zakasneli ponovljeni zahtev ne vraća verziju koja je u međuvremenu zamenjena.
    - Isti ID sa drugačijim sadržajem se odbija (409).
  - **Upisi su vezani za saradnju.** Dodela, izmena plana, cilj ishrane i „pregledano“ nose ID
    saradnje za koju su napravljeni. Ako je ona završena (i, recimo, ponovo uspostavljena), ništa
    se ne upisuje u novu saradnju (409 `collaboration_changed`). Editor plana je vezan za saradnju
    za koju je otvoren.
- **Plan klijenta je niz verzija.** Izmena je nova verzija koja važi od danas ili kasnije, uz
  opcioni razlog koji klijent vidi.
  - Za svaki dan trener bira jedno od tri: zadržava rutinu iz plana, kopira svoju rutinu ili
    pravi rutinu prilagođenu klijentu (težine, ponavljanja, RPE, broj serija).
  - Verzija bez dana pauzira plan.
  - Nova verzija za isti datum zamenjuje staru. Kopije koje više nijedna verzija ne koristi se
    arhiviraju.
  - Započeti i završeni treninzi se ne menjaju, jer trening pamti plan sa kojim je počeo.
  - **Recept je zamrznut:** za svaki dan se, u trenutku pravljenja verzije, čuva šta je trener
    propisao. Klijent trenira sa svojom kopijom rutine i može da je menja, ali istorija plana se ne
    menja. „Zadrži“ zadržava propisano, a ne klijentove izmene.
  - **„Važi do“** je raniji od dva datuma: kraj trajanja ili dan pre sledeće verzije. Istorija se
    zato ne preklapa.
  - **Editor plana** polazi od plana koji važi danas. Kad postoji i budući plan, trener bira koji
    menja.
- **Klijent:**
  - na kartici Trener vidi „Plan od trenera“ (ova nedelja, sledeća verzija) i obaveštenje o
    izmeni iz poslednjih 7 dana;
  - na ekranu Danas vidi „Po planu trenera danas“, sve dok tog dana ne odradi baš tu rutinu
    (drugi, lični trening se ne računa kao plan). Može da trenira i van plana.
- **Pojedinačna dodela rutine** (iz T1) i dalje postoji.

## T2b: pregled treninga, napredak i ishrana

- **Pregled treninga:** trener otvara trening klijenta (iz zadatka ili sa kartice Napredak) i vidi
  planirano (plan sa kojim je trening počeo) i urađeno po vežbi, uključujući preskočene vežbe.
  - Spremnost se prikazuje samo uz dozvolu.
  - Plan iz aplikacije (snimak na početku treninga) server pre prikaza sređuje. Neispravni
    delovi otpadaju, a pokvaren plan se prikazuje kao „nema plana“; urađene serije i komentari
    ostaju dostupni.
  - Obrisan trening vraća 404 sa kodom `workout_not_found`, što nije gubitak pristupa klijentu.
    Gubitak pristupa ima kod `collaboration_not_found`.
  - „Označi kao pregledano“ zatvara zadatak tog treninga. Važi samo za treninge završene tokom
    saradnje; stariji treninzi su istorija.
- **Komentar na trening je poruka** vezana za taj trening (jedan zapis):
  - vidi se u razgovoru (sa linkom na trening), na pregledu treninga kod trenera i na ekranu
    treninga kod klijenta, gde klijent može i da odgovori;
  - ako se trening obriše, poruka ostaje bez linka.
- **Napredak klijenta:** ista statistika koju klijent vidi kod sebe (zbirovi, nedelje, mišići,
  najbolja dizanja), bez podataka o spremnosti ako nisu podeljeni. Treninzi vode na pregled.
- **Kalorijski cilj od trenera:** posebna dozvola klijenta („Trener može da mi postavlja
  kalorijski cilj i makroe“), odvojena od deljenja dnevnika.
  - Cilj važi od danas ili kasnije, jedan cilj po datumu; raniji dani zadržavaju svoj.
  - Klijent ga vidi kao „Postavio trener“, uz napomenu, i može da ga promeni.

## T2c: Nedelja

- **„Nedelja“ (Napredak → Nedeljni osvrt)** je jedan ekran za nedeljni izveštaj i check-in.
  Dostupna je i korisnicima bez trenera.
- **Brojevi nedelje:**
  - treninzi (sa ciljem i, uz plan od trenera, brojem planiranih);
  - obim, radne serije i prosečan RPE;
  - težina i promena;
  - prosečne kalorije iz kompletnih dana, uz cilj;
  - prosečna spremnost.
- **Osvrt korisnika:** energija, napredak, ishrana i (uz trenera) zadovoljstvo programom, na skali
  1–5, plus „šta je bilo najteže“ i napomena. Sve je opciono.
  - Piše se za ovu ili neku od poslednjih osam nedelja; ponovno čuvanje menja isti osvrt.
  - **Korisnik bira primaoca.** Sa trenerom forma nudi „Neka ovaj osvrt vidi i trener {ime}“ i
    šalje tačno tu saradnju; bez kvačice ili bez trenera osvrt je privatan.
  - Server deli osvrt samo ako je baš ta saradnja i dalje aktivna. Ako se trener u međuvremenu
    promenio (drugi tab ili uređaj), ništa se ne čuva i korisnik bira ponovo (409).
  - Kasniji (novi) trener ne nasleđuje ranije osvrte. Privatan osvrt trener vidi tek kad ga
    korisnik ponovo sačuva uz trenera.
- **Trener:**
  - kad klijent sačuva osvrt, trener dobija zadatak „Popunio/la nedeljni osvrt“ (jednom po
    nedelji), koji otvara nedelju klijenta;
  - vidi brojeve samo uz dozvole (težina uz merenja, kalorije uz ishranu, spremnost uz spremnost;
    inače „nije podeljeno“) i osvrt klijenta;
  - može da ostavi komentar.
- **Planirani treninzi u prošlim nedeljama** računaju se po danu, iz plana saradnje koja je tog
  dana važila (i kad je saradnja završena). Prekid ili nova saradnja ne menjaju prošlost. Daje se
  samo broj, nikad tuđi plan.
  - Dogovor je po danu: dan pripada saradnji ako je počela tog ili ranijeg dana, a završena je
    posle njega. Dan prekida pripada novoj saradnji, ako postoji.
- **Komentar na nedelju je poruka vezana za tu nedelju** (isti model kao komentar uz trening).
  Vidi se u razgovoru, sa linkom na nedelju, i na ekranu nedelje kod oba korisnika.

## Pristup na novim trenerovim ekranima (T2)

Plan, pregled treninga, statistika, cilj ishrane i nedelja klijenta prate ista pravila kao profil
klijenta iz T1.

- **Podaci o pristupu:** uz svaki odgovor server šalje saradnju, verziju pristupa i dozvole.
  Aplikacija ih upisuje u evidenciju naloga, koja čuva najvišu viđenu verziju.
- **Opoziv:** posle 403/404 ili završene saradnje podaci se brišu iz keša i ne prikazuju se.
- **Promenjena verzija:** delovi koji traže dozvolu (spremnost, merenja, ishrana, cilj) čekaju novo
  učitavanje na trenutnoj verziji.
- **Osvežavanje:** ovi ekrani se sami osvežavaju na 30 sekundi, pa i otvoren ekran primeti opoziv.


- Povlačenje deljenja nedeljnog osvrta uklanja njegov zadatak i povećava verziju pristupa, u istoj transakciji kao čuvanje osvrta. Zakasneli zadatak ne može se ponovo napraviti dok je osvrt privatan. Prethodno učitani osvrt i zadatak se sakrivaju kada aplikacija sazna za noviju verziju; bez veze opoziv nije trenutno vidljiv.
