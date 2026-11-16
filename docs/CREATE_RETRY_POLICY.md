# Ponovni POST sa istim ID-jem posle mrežne greške

Korisnik može dobiti grešku zbog isteka zahteva iako je server već sačuvao
prvi POST. Kada izmeni nacrt i ponovi zahtev sa istim ID-jem, server ne
sme da prikaže uspeh ako nije primenio izmene.

- **Rutine, recepti i merenja**: identičan POST vraća postojeći zapis (200)
  bez dodatnih promena. Ako se sadržaj razlikuje, isti ID se **ažurira**
  kroz isti DRF serializer i validaciju kao PUT/PATCH, uz status 200.
  Ne vraća se 200 sa starim sadržajem dok su izmene ignorisane.
- **Ciljevi**: ne postoji uređivanje cilja. Ponovljeni POST sa istim
  korisničkim izborom (`kind`, `target_value`, `target_date`) vraća
  **200 OK** bez izmene; razlika u tim poljima vraća **409 Conflict**.
  `start_value` i `start_date` se ne porede jer ih određuje server.
- **Sačuvani obroci**: klijent čuva isti pokušajni ID dok ne dobije uspešan
  odgovor. Identčan ponovni POST vraća 200 bez duplikata, a izmenjen
  zahtev sa postojećim ID-jem vraća 409 (nema uređivanja tog resursa).
  Na 409 frontend odbacuje zauzeti ID i osvežava listu sačuvanih obroka,
  tako da sledeći pokušaj može da počne sa novim ID-jem.
- **Odrađeni treninzi**: ostaju neizmenjivi. Ponovni POST vraća sačuvani
  trening, jer se završena sesija ne menja.

Provera vlasništva je obavezna. Arhivirana rutina/recept se ne oživljava,
a recept koji kolidira sa ID-jem obične namirnice ne sme da je menja.
Poređenje istovetnih zahteva uzima u obzir decimalne ekvivalente
(npr. `60` i `60.00`) i nizove serija/sastojaka.

U dnevniku je najmanja dozvoljena količina namirnice **0,1 g**, isto kao
na serveru. Nema migracije baze.
