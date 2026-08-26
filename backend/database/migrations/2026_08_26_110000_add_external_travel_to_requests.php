<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_requests', function (Blueprint $table) {
            // External travel: a vehicle requested by another arm of the university
            // for an extended trip (often over weekends). Captures the requesting
            // unit, the expected duration, and the odometer reading at hand-over.
            $table->boolean('is_external')->default(false)->index();
            $table->string('external_org')->nullable();          // requesting arm / unit
            $table->unsignedSmallInteger('expected_duration_days')->nullable();
            $table->unsignedInteger('start_odometer')->nullable(); // odometer before trip began
        });
    }

    public function down(): void
    {
        Schema::table('vehicle_requests', function (Blueprint $table) {
            $table->dropColumn(['is_external', 'external_org', 'expected_duration_days', 'start_odometer']);
        });
    }
};
