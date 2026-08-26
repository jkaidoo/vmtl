<?php

namespace Database\Seeders;

use App\Models\Department;
use Illuminate\Database\Seeder;

class DepartmentSeeder extends Seeder
{
    public function run(): void
    {
        $departments = [
            ['name' => 'UITS Support Centre', 'code' => 'UITS-SC'],
            ['name' => 'Network Operations', 'code' => 'UITS-NET'],
            ['name' => 'Systems & Infrastructure', 'code' => 'UITS-INF'],
            ['name' => 'Administration', 'code' => 'UITS-ADM'],
        ];

        foreach ($departments as $d) {
            Department::updateOrCreate(['code' => $d['code']], $d + ['active' => true]);
        }
    }
}
