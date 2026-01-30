import { BadRequestException, HttpException, HttpStatus } from "@nestjs/common";

export function handleError(error: any) {
    if (error instanceof Error && error.message.includes('must be')) {
        throw new BadRequestException({
            success: false,
            error: error.message,
        });
    }
    if (error instanceof BadRequestException) {
        throw error;
    }
    throw new HttpException(
        {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
    );
}