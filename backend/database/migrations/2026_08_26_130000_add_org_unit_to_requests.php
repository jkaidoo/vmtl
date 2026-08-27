<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_requests', function (Blueprint $table) {
            $table->foreignId('org_unit_id')->nullable()->after('department_id')->constrained('org_units')->nullOnDelete();
        });

        // Backfill: a request belongs to its requester's org unit.
        DB::statement('UPDATE vehicle_requests vr JOIN users u ON u.id = vr.requester_id SET vr.org_unit_id = u.org_unit_id WHERE vr.org_unit_id IS NULL');
    }

    public function down(): void
    {
        Schema::table('vehicle_requests', function (Blueprint $table) {
            $table->dropConstrainedForeignId('org_unit_id');
        });
    }
};
