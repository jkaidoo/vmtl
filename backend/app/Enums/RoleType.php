<?php

namespace App\Enums;

enum RoleType: string
{
    case STAFF = 'staff';
    case APPROVER = 'approver';
    case TRANSPORT_ADMIN = 'transport_admin';
    case ADMINISTRATOR = 'administrator';
    case DRIVER = 'driver';

    public function label(): string
    {
        return match ($this) {
            self::STAFF => 'Staff',
            self::APPROVER => 'Approver',
            self::TRANSPORT_ADMIN => 'Transport / Admin Officer',
            self::ADMINISTRATOR => 'System Administrator',
            self::DRIVER => 'Driver',
        };
    }

    /** @return array<int, array{value:string,label:string}> */
    public static function options(): array
    {
        return array_map(fn (self $r) => ['value' => $r->value, 'label' => $r->label()], self::cases());
    }
}
