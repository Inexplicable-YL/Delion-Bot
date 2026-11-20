import { defineView } from '../../../app/module';
import { TodoView } from './TodoView';

export const todoView = defineView({ pages: { todo: { component: TodoView } } });
