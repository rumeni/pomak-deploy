from django.db import migrations, models
from django.db.models import Count, Q
from django.utils import timezone


def deduplicate_open_reports(apps, schema_editor):
    FoodReport = apps.get_model('nutrition', 'FoodReport')
    db = schema_editor.connection.alias
    duplicates = (
        FoodReport.objects.using(db)
        .filter(resolved_at__isnull=True, reporter_id__isnull=False)
        .values('food_id', 'reporter_id')
        .annotate(total=Count('id'))
        .filter(total__gt=1)
    )
    for pair in duplicates.iterator():
        rows = list(
            FoodReport.objects.using(db)
            .filter(food_id=pair['food_id'], reporter_id=pair['reporter_id'], resolved_at__isnull=True)
            .order_by('-created_at', '-pk')
            .values_list('pk', flat=True)
        )
        FoodReport.objects.using(db).filter(pk__in=rows[1:]).update(resolved_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [('nutrition', '0008_community_foods')]

    operations = [
        migrations.RunPython(deduplicate_open_reports, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='foodreport',
            constraint=models.UniqueConstraint(
                fields=('food', 'reporter'),
                condition=Q(resolved_at__isnull=True, reporter__isnull=False),
                name='one_open_food_report_per_user',
            ),
        ),
    ]
