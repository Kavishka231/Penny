import { z } from 'zod';

export const registerSchema = z.object({
	name: z.string().min(1, 'Name is required'),
	email: z.email('A valid email is required'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
}).strict();

export const loginSchema = z.object({
	email: z.email('A valid email is required'),
	password: z.string().min(1, 'Password is required'),
}).strict();

export const forgotPasswordSchema = z.object({
	email: z.email('A valid email is required'),
}).strict();

export const resetPasswordSchema = z.object({
	token: z.string().min(1, 'Token is required'),
	newPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).strict().transform(({ token, newPassword }) => ({
	token,
	password: newPassword,
}));

const profileFieldsSchema = z.object({
	name: z.string().min(1, 'Name must not be empty'),
	email: z.email('A valid email is required'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	phone: z.string().min(1, 'Phone must not be empty'),
	address: z.string().min(1, 'Address must not be empty'),
	preferredCurrency: z.string().min(1, 'Preferred currency must not be empty'),
	themePreference: z.enum(['light', 'dark']),
	budgetResetDay: z.number().int().min(1).max(28),
	dateFormat: z.string().min(1, 'Date format must not be empty'),
}).strict();

export const profileUpdateSchema = profileFieldsSchema.partial();
