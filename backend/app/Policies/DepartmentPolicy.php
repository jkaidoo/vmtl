<?php

namespace App\Policies;

use App\Models\Department;
use App\Models\User;
use App\Support\Capabilities;

class DepartmentPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::DEPARTMENTS_MANAGE);
    }

    public function update(User $user, Department $department): bool
    {
        return $user->hasCapability(Capabilities::DEPARTMENTS_MANAGE);
    }

    public function delete(User $user, Department $department): bool
    {
        return $user->hasCapability(Capabilities::DEPARTMENTS_MANAGE);
    }
}
