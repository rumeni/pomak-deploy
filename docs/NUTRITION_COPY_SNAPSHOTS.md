# Kopiranje stavki dnevnika i sačuvani obroci

## Kopiranje stavke („doručak od juče“)

Kopija ponavlja **tadašnje nutritivne vrednosti** iz originalne stavke, čak
i ako se namirnica ili recept kasnije izmene. Nova stavka šalje svih pet
`per100_*` vrednosti (sa eksplicitnim `null` za nepoznate makroe i vlakna),
`food_id`, gramažu i novi ID. Original ne mora biti u bazi: može i dalje
čekati slanje u offline redu na uređaju.

Server proverava da je namirnica vidljiva korisniku (`Food.visible_to`),
da su poslata **sva pet** polja `per100_*` ili **nijedno**, da je
kcal na 100 g od 0 do 900, a svaka poznata vrednost makroa/vlakana od
0 do 100 g na 100 g. Protein + UH + masti ne smeju biti preko 100 g/100 g.

Snimak se **ne upoređuje** sa današnjom namirnicom: ne postoji pouzdan
dokaz da joj je to bila nekadašnja vrednost. Ponavljanje PUT-a sa istim
ID-jem i istim snimkom je dozvoljeno; promena već sačuvanog snimka nije.

Ako je `food_id` uklonjen, kopija postaje ručni unos sa starim ukupnim
vrednostima. Izmena gramaže postojeće stavke i dalje koristi njen
sačuvani nutritivni snimak.

## Sačuvani obroci i običan novi unos

**Sačuvani obrok koristi trenutne vrednosti namirnice**, kao i običan
novi unos iz pretrage. Ti zahtevi ne šalju `per100_*`: server uzima
trenutne vrednosti pri prvom upisu.

Ova razlika je namerna. Migracija baze nije potrebna; postojeća polja
`per100_*` već čuvaju istorijski snimak.
