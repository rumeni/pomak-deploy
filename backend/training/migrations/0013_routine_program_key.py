from django.db import migrations, models


def backfill_legacy_imports(apps, schema_editor):
    # Older imported routines stored only the program's localised display name
    # in notes. Match both languages; keep user-editable names/notes untouched.
    from training.programs import PROGRAMS

    Routine = apps.get_model('training', 'Routine')
    for program in PROGRAMS:
        for language in ('sr', 'en'):
            Routine.objects.filter(
                program_key='',
                notes=program['name'][language],
                name__in=[r['name'][language] for r in program['routines']],
            ).update(program_key=program['key'])


class Migration(migrations.Migration):
    dependencies = [('training', '0012_glute_exercises')]

    operations = [
        migrations.AddField(
            model_name='routine',
            name='program_key',
            field=models.CharField(blank=True, db_index=True, max_length=80),
        ),
        migrations.RunPython(backfill_legacy_imports, migrations.RunPython.noop),
    ]
