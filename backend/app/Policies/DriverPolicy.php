<?php

namespace App\Policies;

use App\Models\Driver;
use App\Models\User;
use App\Support\Capabilities;

class DriverPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Driver $driver): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::DRIVERS_MANAGE);
    }

    public function update(User $user, Driver $driver): bool
    {
        return $user->hasCapability(Capabilities::DRIVERS_MANAGE);
    }

    public function delete(User $user, Driver $driver): bool
    {
        return $user->hasCapability(Capabilities::DRIVERS_MANAGE);
    }
}
