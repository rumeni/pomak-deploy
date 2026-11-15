from django.test.runner import DiscoverRunner
from django.test.utils import override_settings


class TestRunner(DiscoverRunner):
    """Tokom testova keš ne pamti ništa.

    Ograničenje broja pokušaja (npr. 10 prijava u minuti) broji zahteve u kešu; bez ovoga
    bi testovi koji se prijavljuju počeli da padaju zavisno od toga koliko ih je pre njih.
    """

    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        self._no_cache = override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}})
        self._no_cache.enable()

    def teardown_test_environment(self, **kwargs):
        self._no_cache.disable()
        super().teardown_test_environment(**kwargs)
