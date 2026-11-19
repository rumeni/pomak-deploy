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

## T3a: nepročitane poruke i uputstva za vežbe

### Nepročitane poruke

- **Oznaka pročitanosti.** Svaka strana saradnje ima svoju oznaku: poslednju pročitanu poruku
  (vreme i ID). Nepročitane su poruke druge strane posle nje. Oznaka se pomera samo napred, pa
  stariji ekran ili zakasneli zahtev ne mogu ponovo da označe poruke kao nepročitane.
- **Kada je poruka pročitana.** Kad je ceo razgovor na ekranu i aplikacija je vidljiva.
  Komentari na treningu ili nedelji ne pomeraju oznaku, jer ne prikazuju ceo razgovor.
  Arhivirani razgovor može da se pročita.
- **Gde se vidi.**
  - broj na kartici Poruke (trener) i Trener (klijent);
  - broj uz razgovor i uz klijenta na listi;
  - kartica „N nepročitanih poruka“ na Pregledu, sa imenima klijenata.
- **API.**
  - `POST /api/coach/messages/read/ {message_id}` pomera oznaku do te poruke. Strani razgovor
    vraća 404.
  - `GET /api/coach/unread/` vraća ukupan broj za navigaciju, uz osvežavanje na 30 sekundi.
  - Dashboard i lista razgovora dobijaju nova polja `unread_messages` i `unread`; stara polja
    ostaju, pa starije Android verzije rade kao do sada.
- **Nepročitane poruke nisu zadatak.** Broj se računa uživo i nestaje čim se razgovor pročita,
  pa nema zadatka koji bi trebalo ručno zatvoriti.

### Uputstva za vežbe

- **Šta je uputstvo.** Trenerova stalna napomena za jednu vežbu jednog klijenta (tehnika, tempo,
  na šta da pazi). Po vežbi postoji najviše jedno uputstvo; novo zamenjuje staro, a prazno ga
  briše.
- **Gde ga trener piše.** U pregledu treninga, uz svaku urađenu vežbu, i na listi u tabu Plan.
  Upis nosi ID saradnje, kao i ostali upisi iz T2 (409 `collaboration_changed` za staru saradnju).
- **Koje vežbe.** Samo vežbe iz zajedničke biblioteke ili klijentove lične vežbe, nikad tuđe.
- **Šta klijent vidi.** Uputstvo stoji na kartici te vežbe tokom treninga („Trener: …“), i to
  samo od trenutnog trenera.
  - Server navodi saradnju kojoj uputstva pripadaju.
  - Ako aplikacija zna za drugu saradnju ili za prekid, stara uputstva se sakrivaju.
  - Tokom treninga se osvežavaju svakog minuta.
- **Trener vidi uputstva pod istom kontrolom pristupa kao ostale podatke klijenta.** Kad izgubi
  pristup, brišu se iz keša. Pregled treninga prikazuje samo uputstva iste saradnje.
- **Prvo uputstvo iz taba Plan.** Može se dodati i za vežbu iz trenutnog ili sledećeg plana.
- **Izvoz podataka.** Uputstva su u izvozu i klijenta i trenera.
- **Bez interneta.** Uputstva se učitavaju na početku treninga i ostaju dok je aplikacija
  otvorena. Ako se aplikacija pokrene bez interneta, trening radi normalno, samo bez uputstava.

### Uvođenje na produkciju

- Migracija `coaching.0005_coach_inbox_instructions`.

## T3b: push obaveštenja, slike u porukama i slika trenera

### Push obaveštenja

- **Uključuju se po uređaju, za svoj nalog.** U Profilu je stavka „Obaveštenja na ovom
  uređaju“.
  - Uključivanje je vezano za sesiju koja ga je pokrenulo. Ako dozvola stigne posle odjave ili
    posle prijave drugog naloga, ništa se ne registruje.
  - Uključivanje i isključivanje se nikad ne preklapaju.
  - Uređaj pamti kom nalogu je registrovan; drugi nalog na istom uređaju vidi obaveštenja kao
    isključena.
- **Odjava.**
  - Pretplata na uređaju se odmah poništava, a već prikazana obaveštenja se brišu.
  - Server briše registraciju kroz sam zahtev za odjavu. Na webu se taj zahtev ponavlja dok ne
    uspe.
  - **Svaka registracija je zaseban pokušaj, sa slučajnim ID-jem koji pravi uređaj.**
    - Opoziv (`POST /api/push/devices/remove/` sa `attempt` i `user_id`, bez prijave) ukida
      tačno taj pokušaj za taj nalog i server ga pamti nedelju dana. Registracija tog pokušaja
      koja stigne kasnije se odbija (409 `push_revoked`).
    - Zato redosled nije bitan: opoziv sme da stigne i pre registracije.
    - Kasnije novo uključivanje (novi pokušaj, čak i sa istim tokenom uređaja) ostaje važeće.
    - Push token se nikad ne šalje bez prijave; ID pokušaja zna samo uređaj.
  - **Uređaj pamti opozive koji nisu potvrđeni.** Ponavlja ih pri pokretanju aplikacije i kad se
    vrati internet, pa i odjava bez interneta na Androidu na kraju ukine registraciju.
  - **Odjava dok je registracija na putu.** Ta registracija se odmah opoziva.
  - **Izgubljen odgovor.** Pokušaj sa izgubljenim odgovorom (timeout) se takođe opoziva.
  - **Pokušaji iz drugog taba.** Pri pokretanju se diraju samo pokušaji „u toku“ stariji od
    minut. Mlađi mogu pripadati drugom tabu koji se upravo registruje.
  - **Rani restart.** Pokušaj ostavljen „u toku“ zbog ranog restarta ponovo se proverava posle
    tog minuta: uz tajmer, kad se aplikacija vrati u prvi plan i kad se vrati internet.
  - **Opoziv bez prijave je ograničen.** Najviše 120 zahteva na sat po klijentu. Nepoznat nalog
    se ignoriše, a zapisi o opozivu ističu posle nedelju dana.
- **Prelaz sa #75 (registracije bez ID-ja pokušaja).**
  - Stari red na serveru (`attempt` prazno) važi kao „legacy“. Briše ga samo uklanjanje po
    tokenu: odjava sa `push_token` ili isključivanje iz starije aplikacije.
  - To uklanjanje nikad ne briše noviju registraciju sa ID-jem pokušaja, čak ni sa istim
    tokenom.
  - Starija aplikacija koja ne šalje ID pokušaja i dalje se registruje kao „legacy“.
  - „Legacy“ registracija nikad ne prepisuje registraciju sa ID-jem pokušaja. Zakasneli zahtev
    stare verzije za isti token se prihvata, ali ne menja ništa.
  - Sve registracije istog tokena (i stare i nove verzije) idu jedna po jedna, kroz zajedničko
    zaključavanje po tokenu uređaja. Zaštita važi i kad se obe verzije istovremeno prvi put
    registruju na istom uređaju.
  - **Nadogradnja.** Novija aplikacija posle prijave staru registraciju odmah registruje
    ponovo, sa ID-jem pokušaja, i kad se token nije promenio.
  - **Odjava pre nadogradnje.** Imenuje stari token u (prijavljenom) zahtevu za odjavu. Na webu
    se taj zahtev ponavlja dok ne uspe.
  - **Android bez interneta pre nadogradnje.** Oslanja se na lokalnu odjavu kod Firebase-a:
    kad FCM javi `UNREGISTERED`, server briše uređaj. Token se bez prijave nikad ne šalje.
  - Obaveštenje koje je sistem već primio pre odjave i dalje može da se pojavi.
- **Nova pretplata ili token.** Posle prijave aplikacija osvežava registraciju ako je pregledač
  obnovio pretplatu ili je Firebase promenio token.
- **Kanali.**
  - u pregledaču: Web Push (VAPID), preko service worker-a (`public/push-sw.js`);
  - u Android aplikaciji: Firebase Cloud Messaging (FCM HTTP v1).
- **Šta šaljemo.**
  - nova poruka (i komentar na trening ili nedelju) drugoj strani;
  - izmena plana i novo uputstvo klijentu (bez naziva vežbe);
  - podeljen nedeljni osvrt treneru.
- **Sadržaj obaveštenja.** Samo ko je šta uradio i koji ekran otvara, nikad tekst poruke ili
  zdravstveni podatak. Jezik je jezik primaoca.
- **Kako se šalje.** Preko reda za slanje u bazi (`PushMessage`).
  - Obaveštenje se upisuje u istoj transakciji kao događaj; ako se događaj poništi, nema ni
    obaveštenja.
  - Posle upisa jedan QStash poziv pokreće worker (`/api/internal/push-deliver/`, samo sa
    potpisom za `PUSH_WORKER_URL`). Worker isprazni red u vremenskom okviru od 7 sekundi, a ako
    ostane posla, pokreće se ponovo.
  - Bez QStash-a red se prazni kratko (do 3 s) posle upisa. Ostatak odlazi uz sledeće
    osvežavanje broja nepročitanih poruka, ili najkasnije uz dnevni cron.
  - Svi uređaji primaoca dobijaju obaveštenje istovremeno, sa rokom čekanja od 4 s.
  - Obaveštenje starije od sat vremena se odbacuje.
  - Uređaj koji servis prijavi kao nepostojeći briše se samo ako u međuvremenu nije ponovo
    registrovan.
  - Upisi tokom zahteva samo beleže da ima posla. Isporuka se pokreće jednom, na kraju zahteva
    (`PushKickMiddleware`). Dodela programa za 50 klijenata ima 50 upisa, ali jedno pokretanje.
  - **Sa QStash-om** zahtev samo predaje posao workeru (najviše 2 s) i nikad sam ne zove push
    servise ni Firebase OAuth. Ako predaja ne uspe, obaveštenja ostaju u redu: preuzima ih
    sledeći događaj, osvežavanje broja nepročitanih poruka (za ono što čeka duže od minut) ili
    dnevni cron.
  - **Bez QStash-a** (razvoj, ili dok nije podešen) red se prazni u samom zahtevu.
    - Rok od 3 s važi za ceo put: čekanje na zaključavanje, Firebase OAuth i svako slanje.
    - Ono što ne stigne ostaje u redu.
    - Ovo je samo rezervni režim. Pouzdana isporuka u roku traži QStash.
  - **Privremena greška** (timeout, 429, 5xx) pokušava se ponovo, najviše tri puta, sa razmakom
    od 30 s pa 60 s.
    - Ponovo se šalje samo uređajima koji nisu potvrdili prijem.
    - Worker sam zakazuje sledeći QStash poziv za trenutak kad pokušaj dospeva, pa nije potreban
      novi događaj.
    - Ako to zakazivanje ne uspe, worker vraća grešku i QStash ponavlja poziv.
    - Konačno odbijanje (ostali 4xx) se ne ponavlja.
  - **Isporuka je najbolji pokušaj i „bar jednom“, ne „tačno jednom“.** Ako se izgubi odgovor
    push servisa, ili worker stane posle slanja, a pre upisa ishoda, obaveštenje može da stigne
    dvaput.
  - Greška u slanju nikad ne obara zahtev.
- **Samo pravi push servisi.** Web pretplata se prihvata samo za push servise pregledača:
  Google (FCM), Mozilla, Apple i Microsoft.
  - Adresa mora biti na `https`, na podrazumevanom portu i bez korisničkog imena i lozinke.
  - Ključevi pretplate moraju biti ispravni.
  - Preusmeravanja se ne prate.
  - Provera se ponavlja i pri slanju, pa server nikad ne šalje zahtev na druge adrese.
- **Bez podešavanja servera ništa se ne šalje.** Aplikacija tada ne nudi uključivanje
  obaveštenja.

### Slike

- **Obrada na serveru.** Svaka slika se dekodira, uspravi, smanji i ponovo snimi kao JPEG.
  - Time se brišu svi metapodaci (GPS lokacija, model telefona, vreme) i odbija sve što nije
    prava slika.
  - Do 4 MB po slanju; telefon je pre slanja smanji.
  - Slike u porukama su najviše 1600 px, slika trenera najviše 512 px.
- **Čuvanje.** U bazi (Neon), bez spoljnog naloga. Za pilot je to dovoljno; ako slika bude
  mnogo, isti API može da pređe na Vercel Blob bez promene aplikacije.
- **Ko vidi.**
  - **Sliku iz razgovora** vide samo dve osobe iz te saradnje, i u arhivi. Pre slanja poruke
    sliku vidi samo onaj ko ju je postavio.
  - **Slika trenera** je deo njegove kartice, pa je vidi svaki prijavljen korisnik koji zna ID
    trenera.
- **Bez keširanja.** Slike se šalju sa `Cache-Control: no-store`, a aplikacija ih čuva u
  memoriji odvojeno po nalogu i briše pri odjavi. Drugi nalog na istom uređaju ih ne dobija.
- **Zaključavanje.** Slika se obrađuje van zaključavanja, a upisuje pod zaključanom saradnjom. Ako
  se saradnja u međuvremenu završi, slika se ne čuva.
- **Neposlate slike.** Slika postavljena za poruku koja nije poslata briše se posle jednog dana
  (dnevni cron). Brisanje ide pod istim zaključavanjem kao slanje poruke, pa se slika koja se
  upravo šalje nikad ne obriše.
- **Ograničenja po korisniku.** Najviše 20 neposlatih slika, a dnevno najviše 60 slika i 20 MB.
  Slike jedne osobe upisuju se jedna po jedna (zaključavanje po korisniku), pa paralelni zahtevi
  ne mogu zajedno da pređu limit.
- **Izvoz podataka.** Izvoz za sada samo označava da je poruka imala sliku. Kako korisnik može da
  preuzme svoje slike, treba odlučiti pre šireg puštanja.
- **Poruka sa slikom.** Tekst može da bude prazan. Ponovljeno slanje proverava i sliku, pa isti ID
  sa drugom slikom ne prolazi. Slika iz druge saradnje ili od druge osobe se odbija.

### Uvođenje na produkciju

- **Migracije:** `coaching.0006_coach_photos_images` i `notifications.0001_initial`
  (`PushDevice`, `PushMessage`), zatim `notifications.0002_push_retry_revocation`.
- **Nove biblioteke:** `requirements.txt` dobija `cryptography` i `Pillow`.
- **Isporuka preko QStash-a.** Postavi `PUSH_WORKER_URL` na
  `https://<api>/api/internal/push-deliver/`; QStash ključevi su isti kao za mejlove. Bez toga
  isporuka radi u ograničenom režimu opisanom gore.
- **Web push (VAPID)**, na Vercel projektu `pomak-api`, Production:
  - `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` i `WEB_PUSH_CONTACT`.
  - Ključevi su već postavljeni u Vercel Production 18.11.2026. Ne generisati novi par
    bez plana za ponovno prijavljivanje postojećih browser pretplata.
  - Kontakt može biti `mailto:` ili `https:` URL. Promena Vercel env zahteva novi
    produkcioni deployment da bi ključ bio dostupan kodu.
- **Android push (Firebase projekat `pomak-rs`):**
  1. Firebase Android aplikacija ima package ID `rs.pomak.app`.
  2. **Android klijentska konfiguracija nije u Git repozitorijumu.**
     `frontend/android/app/google-services.json` je u `.gitignore`. U GitHub
     Settings → Secrets and variables → Actions sačuvati **`ANDROID_GOOGLE_SERVICES_JSON`**
     kao repository secret, čija je vrednost kompletan tekst izvornog JSON-a za
     Firebase projekat `pomak-rs`. **To nije servisni nalog.**
  3. Android CI učitava secret **isključivo pri `push` na `main`**, posle
     pregleda i merge-a koda, proverava `project_id=pomak-rs` i
     `package_name=rs.pomak.app`, pa postavlja `VITE_FCM_ENABLED=1`.
     CI za PR ne dobija secret, tako da build bez FCM-a može da se testira
     bez izlaganja vrednosti neproverenom PR kodu. Ako secret izostane,
     Android se gradi bez push-a; proveriti log pre izdavanja APK-a.
     Za lokalni Android build, kopirati JSON u `frontend/android/app/`
     i postaviti `VITE_FCM_ENABLED=1` pre `npm run build`.
  4. U Firebase Console → Project settings → Service accounts → Generate new private key
     preuzeti serverski servisni nalog. Ceo njegov JSON uneti **direktno u Vercel**
     `pomak-api` Production kao šifrovanu osetljivu promenljivu `FCM_SERVICE_ACCOUNT`.
     Ovo **nije** `google-services.json` i nikad ne ide u Git niti u PR komentar.
     Uveriti se da je Firebase Cloud Messaging API (HTTP v1) omogućen.
  5. Pošto PR sa `notifications` kodom bude mergovan, uraditi migracije
     `coaching.0005`, `coaching.0006`, `notifications.0001` i objaviti API/web.
     Na uređaju instalirati novi APK napravljen sa konfiguracijom i proveriti prijavu
     tokena, odobrenje za notifikacije i prijem stvarnog FCM push-a.

## T4: kalendar, zakazivanje, paketi i podsetnici

### Vremenska zona

- **Raspored je u jednoj zoni**, `Europe/Belgrade` (`TIME_ZONE` aplikacije), bez obzira na zonu
  uređaja. Radno vreme, dani u kalendaru, prikazana i upisana vremena su po beogradskom vremenu.
  Kad je uređaj u drugoj zoni, ekran to i kaže.
- **Računanje.** Radno vreme se najpre pretvara u trenutke. Trajanje, korak, preklapanja i rokovi
  se zatim računaju u UTC-u.
  - Termin od 120 minuta traje 120 stvarnih minuta i kad se menja sat.
  - Vreme koje u proleće ne postoji (02:30) pomera se za veličinu „rupe“ (03:30) i nikad se ne
    nudi kao slobodno. Server i aplikacija pri tome primenjuju isto pravilo.
  - U jesen se ponovljeno vreme računa kao prvo od ta dva.
- **Termin pripada danu u kome počinje.** U okviru dodatnog vremena može da traje i posle
  ponoći. Spisak slobodnih termina i provera pri zakazivanju koriste isto pravilo.

### Šta trener podešava (Kalendar → Podešavanja termina)

- **Vrste termina.** Naziv, trajanje (15–240 minuta) i način (uživo ili online).
  - Zakazan termin čuva sopstvenu kopiju vrste (naziv, način, trajanje). Izmena ili uklanjanje
    vrste ne menja već dogovorene termine ni istoriju.
- **Radno vreme.** Do tri opsega po danu u nedelji.
- **Izuzeci.**
  - „Ne radim“ (praznik, odsustvo) ili „Dodatno vreme“ van radnog vremena.
  - Izuzetak „Ne radim“ ništa ne otkazuje sam. Trener odmah vidi koji su termini već zakazani u
    tom periodu.
- **Pravila**, sa početnim vrednostima:

  | Pravilo | Početno | Opseg |
  |---|---|---|
  | Potvrda | automatska; trener može da uključi ručnu | |
  | Otkazivanje od strane klijenta | do 12 sati pre termina | 0–168 sati |
  | Najkasnije zakazivanje | 2 sata unapred | 0–168 sati |
  | Najdalje zakazivanje | 28 dana unapred | 1–90 dana |
  | Početak termina | na svakih 30 minuta | 15, 30 ili 60 minuta |

### Zakazivanje

- **Klijent** (kartica Trener → Moji termini → Zakaži termin) bira vrstu, dan i slobodno vreme.
  - Slobodna vremena računa server: radno vreme, plus dodatno vreme, minus „Ne radim“, minus
    trenerovi i klijentovi termini koji zauzimaju vreme. Uz to važe pravila o najkasnijem i
    najdaljem zakazivanju.
  - Zahtev nosi ID saradnje za koju je formular napravljen. Formular otvoren pre prekida i
    ponovnog povezivanja ne može da zakaže pod novom saradnjom (409 `collaboration_changed`).
- **Bez ručne potvrde** termin je odmah potvrđen. **Sa ručnom potvrdom** termin čeka potvrdu, a
  vreme je u međuvremenu zauzeto.
  - Trener potvrđuje ili odbija, uz razlog koji klijent vidi.
  - Zahtev na koji niko nije odgovorio do početka prikazuje se kao „istekao“.
- **Trener** zakazuje za svog aktivnog klijenta bilo kada, i van radnog vremena. Termin je odmah
  potvrđen.
- **Ponovljeni zahtev.** Termin nosi ID koji pravi aplikacija. Isti ID sa istim zahtevom
  (saradnja, vrsta, vreme, napomena) vraća sačuvani termin, u kom god da je stanju. Isti ID sa
  bilo čim drugačijim se odbija (400).
- **Redosled zaključavanja.**
  - Svaka izmena termina prvo zaključava saradnju, pa raspored trenera.
  - Izmene podešavanja (izuzeci, vrste termina, radno vreme, pravila) zaključavaju isti raspored.
  - Zato provera slobodnog vremena i upis termina nikad ne mogu da se ukrste sa zatvaranjem
    vremena, uklanjanjem vrste ili novim radnim vremenom. Ako trener zatvori vreme dok se termin
    upravo upisuje, sačeka upis i dobije ga u spisku sukoba.
  - Trenutno vreme se čita tek posle zaključavanja.

### Zaštita od duplih rezervacija u bazi

- U samoj bazi postoji Postgres `EXCLUDE USING gist` ograničenje nad vremenskim opsegom termina.
  Važi i po treneru i po klijentu, za termine koji čekaju potvrdu ili su potvrđeni. Dva
  istovremena zahteva za isto vreme ne mogu oba da uspeju.
- Odbijen ili otkazan termin ne zauzima vreme, a termini jedan za drugim su dozvoljeni.
- Kad baza odbije upis, korisnik dobija 409 `slot_taken`.

### Otkazivanje

- **Klijent** otkazuje termin koji čeka potvrdu bilo kada pre početka, a potvrđen termin do roka
  koji je trener podesio. Posle toga se javlja treneru porukom.
- **Trener** otkazuje dok se termin ne završi, uz razlog. Ako termin koristi paket, trener bira
  da li se otkazani termin ipak računa u paket (npr. kasno otkazivanje).
- **Kraj saradnje** otkazuje sve buduće termine te saradnje. Prošli ostaju u oba kalendara.
- **„Moji termini“ kod klijenta** odvajaju predstojeće termine od nedavno otkazanih i odbijenih,
  pa otkazani ne potiskuju prave.

### Paketi treninga

- **Šta je paket.** Brojač uplaćenih treninga; plaćanje je van aplikacije. Ima naziv, broj
  treninga (1–200), datum od kog važi, opcioni datum isteka i napomenu.
- **Iskorišćeno** = potvrđeni termini iz paketa, plus otkazani termini koje je trener odlučio da
  računa, plus trenerova ručna korekcija (npr. +1 za trening van kalendara, −1 za vraćen).
- **Dodela termina.** Potvrđen termin (odmah ili posle potvrde) uzima najstariji otvoren paket
  koji važi na dan termina i u kome je ostalo treninga. Dodela ide pod zaključanom saradnjom, pa
  dva termina nikad ne uzmu isti poslednji trening. Bez takvog paketa termin je bez paketa.
- **Vraćanje.** Termin otkazan na vreme (ili bez računanja) vraća trening u paket.
- **Gde se vidi.**
  - Kod trenera: na profilu klijenta (Pregled → Paketi treninga), sa korekcijom, zatvaranjem
    paketa i spiskom termina iz paketa.
  - Kod klijenta: „preostalo X od Y, važi do …“ u kartici „Moji termini“.
- **Vezano za saradnju.** Upisi nose ID saradnje (409 `collaboration_changed` za staru).

### Podsetnici

- **Kada.** Klijent dobija push podsetnik 24 sata i 1 sat pre potvrđenog termina. Podsetnici
  nastaju pri potvrdi.
- **Šta mora da važi.** Podsetnik se šalje samo ako je termin i dalje potvrđen i počinje u isto
  vreme.
- **Bez kašnjenja i bez ponavljanja.** Ne šalje se ako kasni više od 30 minuta i nikad se ne
  šalje dvaput.
- **Sadržaj** je samo vreme termina, na jeziku primaoca.
- **Isporuka.**
  - Za svaki podsetnik u narednih šest dana worker za push se zakazuje preko QStash-a tačno za
    trenutak kad dospeva. Kasnije podsetnike zakazuje dnevni cron.
  - Bez QStash-a podsetnici odlaze uz osvežavanje broja nepročitanih poruka u otvorenoj
    aplikaciji, ili uz dnevni cron. To je samo rezervni režim; tačni podsetnici traže QStash.

### Gde se vidi i obaveštenja

- **Kod trenera:** kartica **Kalendar**, sa pregledom nedelje po danima.
  - Višednevni izuzeci i termini preko ponoći prikazuju se svakog dana koji pokrivaju, skraćeno
    na taj dan („do 12:00“, „od 22:00“, „ceo dan“).
  - Ceo dan pod izuzetkom „Ne radim“ ne piše „slobodno“.
- **Na Pregledu:** pločica „Termina danas“ i kartica sa zahtevima.
- **Push obaveštenja** idu preko postojećeg reda za slanje i nikad ne sadrže napomenu:
  - zahtev, novi termin i otkazivanje treneru;
  - potvrda, odbijanje, otkazivanje i termin koji je zakazao trener klijentu.
- **Brisanje naloga** trenera ili klijenta radi i kad postoje termini. Brišu se njegovi termini,
  a nalozi drugih ostaju netaknuti.
- **Izvoz podataka** obuhvata termine i pakete.

### Bez interneta

- Zakazivanje i izmene traže internet. Bez veze aplikacija to jasno kaže, a ponovljeni zahtev je
  bezbedan.

### Uvođenje na produkciju

- Migracija `scheduling.0001_scheduling` uključuje proširenje `btree_gist` (Neon ga podržava).
- Za tačne podsetnike i push podesiti `PUSH_WORKER_URL` (QStash), kao u T3.
