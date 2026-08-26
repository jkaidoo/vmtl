<?php

namespace App\Http\Requests;

use App\Enums\MaintenanceType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

class StoreMaintenanceRecordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            'vehicle_id' => ['required', 'exists:vehicles,id'],
            'maintenance_type' => ['required', new Enum(MaintenanceType::class)],
            'service_date' => ['required', 'date'],
            'odometer' => ['nullable', 'integer', 'min:0'],
            'description' => ['nullable', 'string', 'max:2000'],
            'cost' => ['nullable', 'numeric', 'min:0'],
            'service_provider' => ['nullable', 'string', 'max:255'],
            'next_service_date' => ['nullable', 'date'],
            'next_service_odometer' => ['nullable', 'integer', 'min:0'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
