<?php

namespace Database\Seeders;

use App\Models\OrgUnit;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Builds the real KNUST organisational tree from database/data/knust_org_structure.php
 * (derived from col_fac_dep.xlsx) and re-points the demo accounts + fleet onto it.
 *
 * Shape: KNUST (institution)
 *   ├─ College of … (college) → Faculty/School (faculty) → Department (department)
 *   │                            └─ (some departments sit directly under the college)
 *   ├─ Main Administration / Finance Office / UITS / Institute of Distance Learning
 *   │      (directorate) → operational units (unit)
 *   └─ Standalone units (unit, directly under the root — belong to no college)
 *
 * Idempotent: nodes are keyed on (name, parent_id), so re-running reuses existing
 * ids — which is what keeps the demo users/vehicles/requests attached to KNUST,
 * UITS, User Support Services and College of Science wired through a rebuild.
 */
class KnustOrgStructureSeeder extends Seeder
{
    /** Column-B values that are administrative directorates, not colleges. */
    private const DIRECTORATES = [
        'Main Administration',
        'Finance Office',
        'University Information Technology Services',
        'Institute of Distance Learning',
    ];

    public function run(): void
    {
        /** @var array<int, array{0:string,1:string,2:string}> $rows */
        $rows = require database_path('data/knust_org_structure.php');

        $root = $this->ensure('KNUST', 'institution', null, 'KNUST');

        $colleges = [];
        $directorates = [];
        $faculties = [];
        $keptIds = [$root->id];

        foreach ($rows as [$dep, $col, $fac]) {
            if ($col === 'Standalone') {
                // Belongs to no college — a standalone unit under the root.
                $keptIds[] = $this->ensure($dep, 'unit', $root->id)->id;
                continue;
            }

            if (str_starts_with($col, 'College of')) {
                $college = $colleges[$col] ??= $this->ensure($col, 'college', $root->id);
                $keptIds[] = $college->id;

                if ($fac === '') {
                    // Department directly under the college (no faculty).
                    $keptIds[] = $this->ensure($dep, 'department', $college->id)->id;
                } else {
                    $facKey = $col.'||'.$fac;
                    $faculty = $faculties[$facKey] ??= $this->ensure($fac, 'faculty', $college->id);
                    $keptIds[] = $faculty->id;
                    $keptIds[] = $this->ensure($dep, 'department', $faculty->id)->id;
                }
                continue;
            }

            if (in_array($col, self::DIRECTORATES, true)) {
                $dir = $directorates[$col] ??= $this->ensure($col, 'directorate', $root->id);
                $keptIds[] = $dir->id;

                // A self-referential row (department == grouping) IS the directorate
                // node itself — do not create a duplicate leaf.
                if ($dep !== $col) {
                    $keptIds[] = $this->ensure($dep, 'unit', $dir->id)->id;
                }
                continue;
            }

            // Unrecognised grouping — park under the root so nothing is silently lost.
            $keptIds[] = $this->ensure($dep, 'unit', $root->id)->id;
        }

        $this->remapDemo($root);
        $this->pruneObsolete(array_unique($keptIds));
    }

    /**
     * Re-point the demo accounts and fleet onto the rebuilt tree. Keyed by email /
     * vehicle number so it is correct whether the tree was rebuilt or freshly seeded.
     * No-ops for any account that does not exist (e.g. directory users pre-login).
     */
    private function remapDemo(OrgUnit $root): void
    {
        $uits = OrgUnit::where('name', 'University Information Technology Services')->where('parent_id', $root->id)->first();
        $uss = $uits ? OrgUnit::where('name', 'User Support Services')->where('parent_id', $uits->id)->first() : null;
        $cos = OrgUnit::where('name', 'College of Science')->where('parent_id', $root->id)->first();
        $cs = OrgUnit::where('name', 'Computer Science')->when($cos, fn ($q) => $q->whereHas('parent', fn ($p) => $p->where('parent_id', $cos->id)))->first();

        $byEmail = function (string $email, ?OrgUnit $node) {
            if ($node) {
                DB::table('users')->where('email', $email)->update(['org_unit_id' => $node->id]);
            }
        };

        $byEmail('admin@uits.test', $root);
        foreach (['approver@uits.test', 'transport@uits.test', 'driver1@uits.test', 'driver2@uits.test'] as $e) {
            $byEmail($e, $uits);
        }
        foreach (['staff@uits.test', 'ama@uits.test', 'kofi@uits.test'] as $e) {
            $byEmail($e, $uss ?? $uits);
        }

        // Fleet: the central pool sits on UITS; the two demo vans demonstrate
        // cross-branch scoping under Computer Science.
        if ($uits) {
            DB::table('vehicles')->where('vehicle_number', 'like', 'UITS-%')->update(['org_unit_id' => $uits->id]);
            DB::table('drivers')->update(['org_unit_id' => $uits->id]);
        }
        if ($cs) {
            DB::table('vehicles')->where('vehicle_number', 'like', 'CS-VAN-%')->update(['org_unit_id' => $cs->id]);
        }
    }

    /**
     * Remove starter/placeholder org units that are not part of the rebuilt tree.
     * FKs are nullOnDelete, but everything live was re-pointed above first, so this
     * only clears genuinely orphaned nodes.
     */
    private function pruneObsolete(array $keptIds): void
    {
        OrgUnit::withTrashed()->whereNotIn('id', $keptIds)->get()->each(function (OrgUnit $node) {
            $node->forceDelete();
        });
    }

    private function ensure(string $name, string $type, ?int $parentId, ?string $code = null): OrgUnit
    {
        $attributes = ['type' => $type, 'active' => true];
        if ($code !== null) {
            $attributes['code'] = $code;
        }

        return OrgUnit::withTrashed()->updateOrCreate(
            ['name' => $name, 'parent_id' => $parentId],
            $attributes + ['deleted_at' => null],
        );
    }
}
