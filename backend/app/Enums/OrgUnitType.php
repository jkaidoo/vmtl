<?php

namespace App\Enums;

enum OrgUnitType: string
{
    case INSTITUTION = 'institution';
    case COLLEGE = 'college';
    case FACULTY = 'faculty';
    case DIRECTORATE = 'directorate';
    case DEPARTMENT = 'department';
    case UNIT = 'unit';
    case OFFICE = 'office';

    public function label(): string
    {
        return match ($this) {
            self::INSTITUTION => 'Institution',
            self::COLLEGE => 'College',
            self::FACULTY => 'Faculty',
            self::DIRECTORATE => 'Directorate',
            self::DEPARTMENT => 'Department',
            self::UNIT => 'Unit',
            self::OFFICE => 'Office',
        };
    }

    /** @return array<int, array{value:string,label:string}> */
    public static function options(): array
    {
        return array_map(fn (self $t) => ['value' => $t->value, 'label' => $t->label()], self::cases());
    }
}
