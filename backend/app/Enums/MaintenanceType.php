<?php

namespace App\Enums;

enum MaintenanceType: string
{
    case OIL_CHANGE = 'oil_change';
    case TYRES = 'tyres';
    case BRAKE_SERVICE = 'brake_service';
    case GENERAL_SERVICE = 'general_service';
    case ENGINE_REPAIR = 'engine_repair';
    case ELECTRICAL_REPAIR = 'electrical_repair';
    case OTHER = 'other';

    public function label(): string
    {
        return match ($this) {
            self::OIL_CHANGE => 'Oil Change',
            self::TYRES => 'Tyres',
            self::BRAKE_SERVICE => 'Brake Service',
            self::GENERAL_SERVICE => 'General Service',
            self::ENGINE_REPAIR => 'Engine Repair',
            self::ELECTRICAL_REPAIR => 'Electrical Repair',
            self::OTHER => 'Other',
        };
    }

    /** @return array<int, array{value:string,label:string}> */
    public static function options(): array
    {
        return array_map(fn (self $t) => ['value' => $t->value, 'label' => $t->label()], self::cases());
    }
}
