"""The coach's daily meal plan (T7): only with the client's consent, shared foods only, logged by the client."""

import uuid

from rest_framework.test import APITestCase

from accounts.models import User
from coaching.models import CoachConnection, MealPlanItem
from nutrition.models import Food


class MealPlanTests(APITestCase):
    def setUp(self):
        self.coach = self.user('meal-coach@example.test', coach=True, name='Nina')
        self.other_coach = self.user('meal-other@example.test', coach=True)
        self.ana = self.user('meal-ana@example.test')
        self.connection = CoachConnection.objects.create(coach=self.coach, client=self.ana, coach_sets_nutrition=True)
        self.oats = Food.objects.get(slug='oats')
        self.milk = Food.objects.get(slug='milk-2')
        self.egg = Food.objects.get(slug='egg-boiled')
        self.url = f'/api/coach/clients/{self.ana.pk}/meal-plan/'

    def user(self, email, *, coach=False, name=''):
        user = User.objects.create_user(email, 'a-strong-secret')
        user.profile.is_coach = coach
        user.profile.display_name = name
        user.profile.save()
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def save(self, items, connection=None):
        self.as_user(self.coach)
        return self.client.put(self.url, {'connection_id': str((connection or self.connection).pk), 'items': items}, format='json')

    def item(self, food, meal='breakfast', grams='60', portion=''):
        return {'meal': meal, 'food_id': str(food.pk), 'grams': grams, 'portion_name': portion}

    def test_coach_sets_the_plan_and_the_client_sees_it_shaped_for_one_tap_logging(self):
        response = self.save([self.item(self.oats), self.item(self.milk, grams='200'), self.item(self.egg, meal='lunch', grams='100', portion='2 jaja')])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([(i['meal'], i['food']['id'], i['grams']) for i in response.data['items']],
                         [('breakfast', str(self.oats.pk), '60.0'), ('breakfast', str(self.milk.pk), '200.0'), ('lunch', str(self.egg.pk), '100.0')])
        self.as_user(self.ana)
        mine = self.client.get('/api/coach/meal-plan/').data
        self.assertEqual(mine['coach_name'], 'Nina')
        self.assertIsNotNone(mine['updated_at'])
        first = mine['items'][0]
        # Same shape as a saved meal's item: a food (values at logging time) and an amount, never manual values.
        self.assertEqual(set(first), {'meal', 'food', 'grams', 'portion_name', 'name', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'})
        self.assertEqual((first['food']['kcal'], first['kcal'], first['name']), (str(self.oats.kcal), None, ''))
        self.assertEqual(mine['items'][2]['portion_name'], '2 jaja')

    def test_saving_replaces_the_whole_plan(self):
        self.save([self.item(self.oats), self.item(self.milk)])
        self.assertEqual(self.save([self.item(self.egg, meal='dinner')]).status_code, 200)
        self.assertEqual(list(MealPlanItem.objects.values_list('meal', 'food_id')), [('dinner', self.egg.pk)])
        self.assertEqual(self.save([]).status_code, 200)
        self.assertFalse(MealPlanItem.objects.exists())
        self.as_user(self.ana)
        self.assertIsNone(self.client.get('/api/coach/meal-plan/').data)

    def test_only_with_the_clients_consent_to_guide_nutrition(self):
        self.save([self.item(self.oats)])
        self.connection.coach_sets_nutrition = False
        self.connection.save()
        refused = self.save([self.item(self.milk)])
        self.assertEqual(refused.status_code, 400)
        # Serbian by default, from the compiled catalog.
        self.assertIn('Klijent ti nije dozvolio da vodiš njegovu ishranu.', str(refused.data))
        self.assertEqual(list(MealPlanItem.objects.values_list('food_id', flat=True)), [self.oats.pk])
        self.as_user(self.coach)
        self.assertEqual((self.client.get(self.url).data['allowed'], self.client.get(self.url).data['items']), (False, []))
        # Without consent the client sees no plan either.
        self.as_user(self.ana)
        self.assertIsNone(self.client.get('/api/coach/meal-plan/').data)

    def test_only_shared_foods_and_sane_amounts(self):
        own = Food.objects.create(owner=self.coach, source='custom', name='Coach bar', kcal='400')
        archived = Food.objects.get(slug='apple')
        archived.archived_at = archived.created_at
        archived.save()
        for bad in ([self.item(own)], [self.item(archived)], [self.item(self.oats, meal='brunch')],
                    [self.item(self.oats, grams='0')], [{'meal': 'lunch', 'food_id': str(uuid.uuid4()), 'grams': '10'}],
                    [self.item(self.oats)] * (MealPlanItem.MAX_ITEMS + 1)):
            self.assertEqual(self.save(bad).status_code, 400, bad[:1])
        self.assertFalse(MealPlanItem.objects.exists())

    def test_only_the_coach_of_this_active_collaboration(self):
        self.as_user(self.other_coach)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.as_user(self.ana)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        # A delayed write meant for an earlier collaboration never lands in the current one.
        old = CoachConnection.objects.create(coach=self.coach, client=self.user('meal-old@example.test'))
        self.assertEqual(self.save([self.item(self.oats)], connection=old).status_code, 409)
        self.connection.ended_at = self.connection.created_at
        self.connection.save()
        self.assertIn(self.save([self.item(self.oats)]).status_code, (404, 409))
        self.as_user(self.ana)
        self.assertIsNone(self.client.get('/api/coach/meal-plan/').data)

    def test_the_plan_is_part_of_the_clients_data_export(self):
        self.save([self.item(self.oats, portion='1 šolja')])
        from accounts.export import collect
        data = collect(self.ana)
        self.assertEqual([(i['meal'], float(i['grams']), i['portion_name']) for i in data['coaching']['meal_plan_items']],
                         [('breakfast', 60.0, '1 šolja')])
