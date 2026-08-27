<?php

use App\Models\Department;
use App\Models\OrgUnit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('org_units', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('code')->nullable();
            $table->string('type')->default('unit')->index();      // college/faculty/department/unit/office/directorate
            $table->foreignId('parent_id')->nullable()->constrained('org_units')->nullOnDelete();
            $table->string('path')->nullable()->index();           // materialised ancestor path, e.g. /1/2/5/
            $table->boolean('active')->default(true)->index();
            $table->timestamps();
            $table->softDeletes();
        });

        // The scoping dimension on people and fleet.
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('org_unit_id')->nullable()->after('department_id')->constrained('org_units')->nullOnDelete();
        });
        Schema::table('vehicles', function (Blueprint $table) {
            $table->foreignId('org_unit_id')->nullable()->after('status')->constrained('org_units')->nullOnDelete();
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->foreignId('org_unit_id')->nullable()->after('status')->constrained('org_units')->nullOnDelete();
        });

        $this->seedTreeAndBackfill();
    }

    private function seedTreeAndBackfill(): void
    {
        // ---- Starter tree -------------------------------------------------
        $knust = OrgUnit::create(['name' => 'KNUST', 'code' => 'KNUST', 'type' => 'institution']);
        // The central fleet lives at the directorate node itself so it serves every
        // UITS sub-unit (serving scope = a unit + its ancestors).
        $uits = OrgUnit::create(['name' => 'University Information Technology Services', 'code' => 'UITS', 'type' => 'directorate', 'parent_id' => $knust->id]);

        // Migrate the existing flat departments into the tree (under UITS).
        $deptMap = [];
        foreach (Department::all() as $dept) {
            $node = OrgUnit::create([
                'name' => $dept->name,
                'code' => $dept->code,
                'type' => 'unit',
                'parent_id' => $uits->id,
                'active' => (bool) $dept->active,
            ]);
            $deptMap[$dept->id] = $node->id;
        }

        // A sample academic branch to show the hierarchy scaling.
        $cos = OrgUnit::create(['name' => 'College of Science', 'code' => 'COS', 'type' => 'college', 'parent_id' => $knust->id]);
        $fpcs = OrgUnit::create(['name' => 'Faculty of Physical & Computational Sciences', 'code' => 'FPCS', 'type' => 'faculty', 'parent_id' => $cos->id]);
        OrgUnit::create(['name' => 'Department of Computer Science', 'code' => 'CS', 'type' => 'department', 'parent_id' => $fpcs->id]);

        // ---- Backfill people and fleet -----------------------------------
        // Approvers / transport officers default to the directorate (central, so
        // they can run the whole UITS fleet); drivers to the pool; the super admin
        // to the root; everyone else to their mapped department, else UITS.
        $roleSlugs = DB::table('roles')->pluck('slug', 'id'); // id => slug
        foreach (DB::table('users')->get(['id', 'department_id', 'role_id', 'is_super_admin']) as $u) {
            $slug = $roleSlugs[$u->role_id] ?? null;

            if ($u->is_super_admin) {
                $orgId = $knust->id;
            } elseif (in_array($slug, ['approver', 'transport_admin'], true)) {
                $orgId = $uits->id;
            } elseif ($slug === 'driver') {
                $orgId = $uits->id;
            } elseif ($u->department_id && isset($deptMap[$u->department_id])) {
                $orgId = $deptMap[$u->department_id];
            } else {
                $orgId = $uits->id;
            }

            DB::table('users')->where('id', $u->id)->update(['org_unit_id' => $orgId]);
        }

        // Existing fleet + drivers form the central UITS pool.
        DB::table('vehicles')->update(['org_unit_id' => $uits->id]);
        DB::table('drivers')->update(['org_unit_id' => $uits->id]);
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('org_unit_id');
        });
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropConstrainedForeignId('org_unit_id');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('org_unit_id');
        });
        Schema::dropIfExists('org_units');
    }
};
