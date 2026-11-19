# Kalorijski metod `msj-v2` — za stručnu proveru

**Status: predlog, NIJE stručno proveren.** Specifikacija (poglavlje 07) traži da se formula,
faktori aktivnosti, raspodela makroa, tempo i zaštitne granice stručno provere pre objavljivanja.
Aplikacija cilj prikazuje kao *početnu procenu* i uz njega čuva ulaze, verziju metoda i datum.

Kod: `backend/nutrition/targets.py` (sve konstante su na jednom mestu).

Aktuelna verzija je `msj-v2`, sa četiri cilja. Ciljevi izračunati verzijom `msj-v1` (gubitak /
održavanje / dobijanje) ostaju sačuvani sa svojim brojevima, ulazima i objašnjenjem. Aplikacija
ih prikazuje pod novim nazivima (`lose` → gubitak masnog tkiva, `maintain` → održavanje forme,
`gain` → povećanje mišićne mase). Stariji APK-ovi i dalje šalju stare vrednosti, a server ih
prihvata kao nove ciljeve.

Vrednosti su **početne preporuke za zdrave odrasle osobe koje treniraju**, ne univerzalno
optimalne vrednosti. Korisnik uvek može da unese svoj cilj, a trener cilj svog klijenta.
Testovi sa primerima proračuna: `backend/nutrition/tests/test_targets.py`.

## Tok proračuna

1. **Ulazi:** pol, starost (na dan početka cilja), visina, poslednje merenje težine, nivo aktivnosti,
   cilj i tempo (samo za gubitak i povećanje mase).
2. **BMR (Mifflin-St Jeor):** `10·kg + 6,25·cm − 5·godine + 5` (M) ili `− 161` (Ž).
3. **Potrošnja:** BMR × faktor aktivnosti. Faktor **uključuje** treninge; kalorije sa treninga se
   nikad ne dodaju na cilj (sprečava dvostruko računanje).
4. **Promena za tempo:** `± težina × tempo% × 7700 / 7` kcal dnevno. Rekompozicija i održavanje
   nemaju tempo ni cilj promene kilograma.
5. **Cilj:** zaokružen na 10 kcal.
6. **Makroi:** proteini po cilju (tabela ispod), računati prema prilagođenoj težini kod veće
   telesne mase; masti 25 % energije; ugljeni hidrati: ostatak.

## Ciljevi (`msj-v2`)

| Cilj | Kalorije | Proteini | Izvor |
|---|---|---|---|
| Gubitak masnog tkiva | TDEE − tempo 0,25 / 0,5 / 0,75 / 1 % mase nedeljno | 2,0 g/kg | Helms i sar. *JISSN* 2014;11:20 (sporiji gubitak, više proteina u deficitu); ISSN, Jäger i sar. *JISSN* 2017;14:20 |
| Povećanje mišićne mase | TDEE + tempo 0,1 / 0,25 / 0,5 % mase nedeljno | 1,8 g/kg | Iraki i sar. *Sports* 2019;7:154 (mali suficit, 1,6–2,2 g/kg) |
| Rekompozicija tela | TDEE (održavanje), bez tempa | 2,0 g/kg | Barakat i sar. *Strength Cond J* 2020;42(5):7-21 |
| Održavanje forme | TDEE | 1,6 g/kg | Morton i sar. *Br J Sports Med* 2018;52:376-384 |

- **Rekompozicija** je za one koji žele manje masnog tkiva i više mišića uz približno istu
  težinu. Uz nju aplikacija naglašava:
  - redovan trening snage i dovoljno proteina;
  - praćenje obima struka (jednom nedeljno), proseka težine i napretka u snazi (procenjeni 1RM);
  - da su to indirektni pokazatelji: aplikacija ne procenjuje procenat masnog tkiva i ne
    obećava rezultate.

## Proteini kod veće telesne mase (prilagođena težina)

Preporuka u g/kg stvarne težine raste nerealno sa masnim tkivom: osoba od 120 kg bi pri 2,0 g/kg
dobila 240 g dnevno. Zato se proteini računaju prema **prilagođenoj težini** (*adjusted body
weight*), kako se radi u kliničkoj nutriciji (Krenitsky J. *Nutr Clin Pract* 2005;20(4):468-73):

- **Referentna težina** = BMI 25 × visina² (m).
- **Do referentne težine** računa se stvarna težina.
- **Iznad nje**: referentna težina + **0,4** × (stvarna − referentna).

Obrazloženje:
- **Nema naglog prelaza.** Formula je neprekidna: na referentnoj težini obe grane daju isto, a
  male promene težine daju male promene preporuke na svakoj težini, i oko BMI 30.
- **Primer.** 120 kg i 180 cm: referentna težina je 81 kg, prilagođena 81 + 0,4 × 39 = 96,6 kg,
  pa je pri 2,0 g/kg preporuka oko 193 g umesto 240 g.
- **Faktor.** 0,4 je sredina uobičajenog opsega 0,25–0,5 za ovu namenu.
- **Šta BMI nije.** BMI nije pokazatelj sastava tela: ovde služi samo kao gornja zaštita od
  prevelike preporuke, a ne kao procena masnog tkiva. Mišićava osoba sa visokim BMI može dobiti
  nešto nižu preporuku od optimalne; zato aplikacija to kaže uz proračun, a cilj se uvek može
  ručno podesiti.
- **Primena.** Važi za sva četiri cilja; kalorije se i dalje računaju prema stvarnoj težini
  (Mifflin–St Jeor).

## Konstante i izvori

| Konstanta | Vrednost | Izvor |
|---|---|---|
| BMR formula | Mifflin-St Jeor | Mifflin MD, St Jeor ST i sar. *Am J Clin Nutr* 1990;51(2):241-7 |
| Faktori aktivnosti | 1,2 / 1,375 / 1,55 / 1,725 / 1,9 | McArdle, Katch & Katch, *Exercise Physiology* (uobičajena primena) |
| Tempo gubitka | 0,25 / 0,5 / 0,75 / 1 % mase nedeljno | uobičajena praksa; **treba potvrditi** |
| Tempo dobijanja | 0,1 / 0,25 / 0,5 % mase nedeljno | uobičajena praksa; **treba potvrditi** |
| Energija 1 kg mase | 7.700 kcal | Wishnofsky 1958 (poznato pojednostavljenje) |
| Donja granica | 1.200 kcal (Ž) / 1.500 kcal (M) | NHLBI Clinical Guidelines 1998 |
| Proteini | po cilju: 2,0 / 1,8 / 2,0 / 1,6 g/kg | vidi „Ciljevi“ |
| Prilagođena težina | referentna (BMI 25) + 0,4 × višak | Krenitsky 2005 |
| Masti | 25 % energije | AMDR 20–35 %, Institute of Medicine 2005 |
| Starost | 18–80 god. | MSJ razvijen na odraslima 19–78 god.; **treba potvrditi** |

## Kada nema automatske preporuke (AC-06)

- mlađi od 18 ili stariji od 80 godina;
- trudnoća, dojenje, poremećaj ishrane ili bolest zbog koje ishranu vodi lekar (korisnik to označava pre proračuna);
- nedostaje pol, datum rođenja, visina ili težina;
- rezultat je ispod donje granice (predlaže se sporiji tempo);
- proteini i masti zajedno premašuju cilj.

Takav korisnik može da unese **svoj cilj** ili (kasnije) da ga vodi trener.

## Pravila cilja (AC-07)

- Jedan cilj po datumu; za dan važi poslednji cilj koji je počeo tog dana ili ranije.
- Novi cilj važi od danas ili kasnije; raniji dani zadržavaju tadašnji cilj.
- Cilj se ne menja sam od sebe (ni posle jednog merenja težine); novi proračun pokreće korisnik
  i vidi ga pre prihvatanja.

## Pitanja za stručnjaka

1. Da li su faktori aktivnosti i opisi nivoa (ekran „Nivo aktivnosti“) primereni?
2. Da li za osobe sa visokim BMI proteine računati prema referentnoj/ciljnoj težini umesto trenutne?
3. Da li su dozvoljeni tempi i donje granice prihvatljivi?
4. Da li gornju starosnu granicu (80) i listu stanja bez automatske preporuke treba menjati?
5. Da li umesto poslednjeg merenja uzimati prosek merenja iz poslednjih 7 dana?
