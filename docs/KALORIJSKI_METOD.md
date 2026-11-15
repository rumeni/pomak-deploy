# Kalorijski metod `msj-v1` — za stručnu proveru

**Status: predlog, NIJE stručno proveren.** Specifikacija (poglavlje 07) traži da se formula,
faktori aktivnosti, raspodela makroa, tempo i zaštitne granice stručno provere pre objavljivanja.
Aplikacija cilj prikazuje kao *početnu procenu* i uz njega čuva ulaze, verziju metoda i datum.

Kod: `backend/nutrition/targets.py` (sve konstante su na jednom mestu).
Testovi sa primerima proračuna: `backend/nutrition/tests/test_targets.py`.

## Tok proračuna

1. **Ulazi:** pol, starost (na dan početka cilja), visina, poslednje merenje težine, nivo aktivnosti,
   smer (gubitak / održavanje / dobijanje) i tempo.
2. **BMR (Mifflin-St Jeor):** `10·kg + 6,25·cm − 5·godine + 5` (M) ili `− 161` (Ž).
3. **Potrošnja:** BMR × faktor aktivnosti. Faktor **uključuje** treninge; kalorije sa treninga se
   nikad ne dodaju na cilj (sprečava dvostruko računanje).
4. **Promena za tempo:** `± težina × tempo% × 7700 / 7` kcal dnevno.
5. **Cilj:** zaokružen na 10 kcal.
6. **Makroi:** proteini 1,6 g/kg; masti 25 % energije; ugljeni hidrati: ostatak.

## Konstante i izvori

| Konstanta | Vrednost | Izvor |
|---|---|---|
| BMR formula | Mifflin-St Jeor | Mifflin MD, St Jeor ST i sar. *Am J Clin Nutr* 1990;51(2):241-7 |
| Faktori aktivnosti | 1,2 / 1,375 / 1,55 / 1,725 / 1,9 | McArdle, Katch & Katch, *Exercise Physiology* (uobičajena primena) |
| Tempo gubitka | 0,25 / 0,5 / 0,75 / 1 % mase nedeljno | uobičajena praksa; **treba potvrditi** |
| Tempo dobijanja | 0,1 / 0,25 / 0,5 % mase nedeljno | uobičajena praksa; **treba potvrditi** |
| Energija 1 kg mase | 7.700 kcal | Wishnofsky 1958 (poznato pojednostavljenje) |
| Donja granica | 1.200 kcal (Ž) / 1.500 kcal (M) | NHLBI Clinical Guidelines 1998 |
| Proteini | 1,6 g/kg | ISSN stav, Jäger i sar. 2017 (opseg 1,4–2,0 g/kg) |
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
