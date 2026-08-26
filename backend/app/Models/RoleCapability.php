<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RoleCapability extends Model
{
    protected $fillable = ['role_id', 'capability'];

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }
}
