<?php

namespace App\Policies;

use App\Models\MaintenanceRecord;
use App\Models\User;
use App\Support\Capabilities;

class MaintenanceRecordPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, MaintenanceRecord $record): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::MAINTENANCE_MANAGE);
    }

    public function update(User $user, MaintenanceRecord $record): bool
    {
        return $user->hasCapability(Capabilities::MAINTENANCE_MANAGE);
    }

    public function delete(User $user, MaintenanceRecord $record): bool
    {
        return $user->hasCapability(Capabilities::MAINTENANCE_MANAGE);
    }
}
