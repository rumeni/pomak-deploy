from django.test import SimpleTestCase

from core.text import normalize_search


class NormalizeSearchTests(SimpleTestCase):
    def test_strips_serbian_diacritics(self):
        self.assertEqual(normalize_search('Pileće  BELO meso'), 'pilece belo meso')
        self.assertEqual(normalize_search('šljiva žuta čokolada'), 'sljiva zuta cokolada')

    def test_dj_is_expanded(self):
        self.assertEqual(normalize_search('Đumbir'), 'djumbir')
        self.assertEqual(normalize_search('međuobrok'), 'medjuobrok')
