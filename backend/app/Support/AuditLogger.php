<?php

namespace App\Support;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

class AuditLogger
{
    /**
     * Record an auditable action.
     *
     * @param  array<string,mixed>|null  $old
     * @param  array<string,mixed>|null  $new
     */
    public static function log(
        string $action,
        string $description,
        ?Model $entity = null,
        ?array $old = null,
        ?array $new = null,
        ?User $actor = null,
    ): AuditLog {
        $actor ??= Auth::user();

        return AuditLog::create([
            'user_id' => $actor?->id,
            'action' => $action,
            'description' => $description,
            'entity_type' => $entity ? class_basename($entity) : null,
            'entity_id' => $entity?->getKey(),
            'old_values' => $old,
            'new_values' => $new,
            'ip_address' => Request::ip(),
            'user_agent' => (string) Request::header('User-Agent'),
            'created_at' => now(),
        ]);
    }
}
