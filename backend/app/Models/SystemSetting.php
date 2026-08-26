<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class SystemSetting extends Model
{
    protected $fillable = ['key', 'value', 'type', 'group', 'label'];

    public static function get(string $key, mixed $default = null): mixed
    {
        // Cache the resolved scalar value (never the Eloquent model — caching a
        // model serializes it and can deserialize as an incomplete object).
        $cacheKey = "setting:{$key}";

        if (Cache::has($cacheKey)) {
            return Cache::get($cacheKey);
        }

        $setting = static::where('key', $key)->first();
        $value = $setting ? static::castValue($setting->value, $setting->type) : $default;

        Cache::forever($cacheKey, $value);

        return $value;
    }

    public static function set(string $key, mixed $value, string $type = 'string', string $group = 'general'): void
    {
        $stored = $type === 'json' ? json_encode($value) : (string) $value;

        static::updateOrCreate(['key' => $key], ['value' => $stored, 'type' => $type, 'group' => $group]);
        Cache::forget("setting:{$key}");
    }

    protected static function castValue(?string $value, string $type): mixed
    {
        return match ($type) {
            'integer' => (int) $value,
            'boolean' => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            'json' => json_decode((string) $value, true),
            default => $value,
        };
    }
}
