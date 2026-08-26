<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vehicle_id')->constrained('vehicles')->cascadeOnDelete();
            $table->string('maintenance_type');
            $table->date('service_date');
            $table->unsignedBigInteger('odometer')->nullable();
            $table->text('description')->nullable();
            $table->decimal('cost', 12, 2)->nullable();
            $table->string('service_provider')->nullable();
            $table->date('next_service_date')->nullable();
            $table->unsignedBigInteger('next_service_odometer')->nullable();
            $table->text('remarks')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_records');
    }
};
