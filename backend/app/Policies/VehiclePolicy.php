<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Vehicle;
use App\Support\Capabilities;

class VehiclePolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Vehicle $vehicle): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::VEHICLES_MANAGE);
    }

    public function update(User $user, Vehicle $vehicle): bool
    {
        return $user->hasCapability(Capabilities::VEHICLES_MANAGE);
    }

    public function delete(User $user, Vehicle $vehicle): bool
    {
        return $user->hasCapability(Capabilities::VEHICLES_MANAGE);
    }
}
