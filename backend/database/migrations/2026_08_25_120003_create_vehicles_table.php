<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->id();
            $table->string('vehicle_number')->unique();     // e.g. UITS-01
            $table->string('registration_number')->unique();
            $table->string('make')->nullable();
            $table->string('model')->nullable();
            $table->unsignedSmallInteger('year')->nullable();
            $table->string('vehicle_type')->nullable();
            $table->string('colour')->nullable();
            $table->unsignedSmallInteger('capacity')->default(1);
            $table->unsignedBigInteger('current_odometer')->default(0);
            $table->string('status')->default('available')->index();
            $table->date('acquisition_date')->nullable();
            $table->date('insurance_expiry')->nullable();
            $table->date('roadworthy_expiry')->nullable();
            $table->unsignedInteger('service_interval_km')->nullable();
            $table->date('last_service_date')->nullable();
            $table->unsignedBigInteger('last_service_odometer')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('active')->default(true)->index();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicles');
    }
};
