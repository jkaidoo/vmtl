<?php

namespace App\Policies;

use App\Models\FuelLog;
use App\Models\User;
use App\Support\Capabilities;

class FuelLogPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, FuelLog $log): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::FUEL_LOG);
    }

    public function update(User $user, FuelLog $log): bool
    {
        return $user->hasCapability(Capabilities::FUEL_LOG);
    }

    public function delete(User $user, FuelLog $log): bool
    {
        return $user->hasCapability(Capabilities::FUEL_LOG);
    }
}
