import datetime

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from nutrition.models import Meal

from .models import Profile, User


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = [
            'display_name', 'language', 'is_coach', 'tracks_training', 'tracks_nutrition', 'onboarding_completed_at',
            'training_experience', 'weekly_workouts_target', 'sex', 'birth_date', 'height_cm', 'meals',
        ]
        read_only_fields = ['is_coach', 'onboarding_completed_at']
        extra_kwargs = {
            'height_cm': {'min_value': 100, 'max_value': 250},
            'weekly_workouts_target': {'min_value': 1, 'max_value': 14},
        }

    def validate_meals(self, value):
        if value is None:
            return value
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError(_('Invalid meal settings.'))
        cleaned, seen = [], set()
        for item in value:
            if not isinstance(item, dict) or item.get('key') not in Meal.values or item['key'] in seen:
                raise serializers.ValidationError(_('Invalid meal settings.'))
            name = str(item.get('name', '')).strip()
            if len(name) > 40:
                raise serializers.ValidationError(_('A meal name can have at most 40 characters.'))
            seen.add(item['key'])
            cleaned.append({'key': item['key'], 'name': name, 'enabled': bool(item.get('enabled', True))})
        if not any(m['enabled'] for m in cleaned):
            raise serializers.ValidationError(_('At least one meal must be enabled.'))
        return cleaned

    def validate_birth_date(self, value):
        if value is None:
            return value
        today = timezone.localdate()
        if value >= today:
            raise serializers.ValidationError(_('Date of birth must be in the past.'))
        if value < today - datetime.timedelta(days=110 * 366):
            raise serializers.ValidationError(_('Please check the date of birth.'))
        return value


class MeSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer()

    class Meta:
        model = User
        fields = ['id', 'email', 'profile']
        read_only_fields = ['id', 'email']

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', {})
        for field, value in profile_data.items():
            setattr(instance.profile, field, value)
        instance.profile.save()
        return instance


class RegisterSerializer(serializers.Serializer):
    ACCOUNT_TYPES = [('client', _('I train for myself')), ('coach', _('I am a coach'))]

    account_type = serializers.ChoiceField(choices=ACCOUNT_TYPES, default='client')
    language = serializers.ChoiceField(choices=settings.LANGUAGES, default='sr-latn')
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    display_name = serializers.CharField(max_length=80, required=False, allow_blank=True)

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(_('An account with this email already exists.'))
        return value

    def validate(self, attrs):
        validate_password(attrs['password'], User(email=attrs['email']))
        return attrs

    def create(self, validated_data):
        user = User.objects.create_user(validated_data['email'], validated_data['password'])
        user.profile.display_name = validated_data.get('display_name', '')
        user.profile.is_coach = validated_data['account_type'] == 'coach'
        user.profile.language = validated_data['language']
        user.profile.save()
        return user

    def to_representation(self, user):
        refresh = RefreshToken.for_user(user)
        return {'access': str(refresh.access_token), 'refresh': str(refresh)}


class LoginSerializer(TokenObtainPairSerializer):
    default_error_messages = {'no_active_account': _('Wrong email or password.')}

    def validate(self, attrs):
        attrs[self.username_field] = attrs[self.username_field].lower()
        return super().validate(attrs)
