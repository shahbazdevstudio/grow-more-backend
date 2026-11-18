const svc = require('../services/notesService');
const todo = require('../services/todoService');
const V = require('../validators/notes.validator');
const { objectId } = require('../validators/common');

const id = (req) => objectId(req.params.id, 'id'); const u = (req) => req.user.id; const tz = (req) => req.user.settings.timezone;
exports.list = async (req, res) => res.json(await svc.list(u(req), tz(req), V.parseNoteList(req.query)));
exports.get = async (req, res) => res.json({ note: await svc.get(u(req), id(req)) });
exports.create = async (req, res) => res.status(201).json({ note: await svc.create(u(req), V.parseNote(req.body)) });
exports.update = async (req, res) => res.json({ note: await svc.update(u(req), id(req), V.parseNote(req.body)) });
exports.pin = async (req, res) => res.json({ note: await svc.setPinned(u(req), id(req), req.body && req.body.pinned === true) });
exports.remove = async (req, res) => res.json({ note: await svc.remove(u(req), id(req)) });
exports.restore = async (req, res) => res.json({ note: await svc.restore(u(req), id(req)) });

exports.todoList = async (req, res) => res.json(await todo.list(u(req), tz(req), V.parseTodoList(req.query)));
exports.todoCreate = async (req, res) => res.status(201).json({ todo: await todo.create(u(req), V.parseTodo(req.body)) });
exports.todoUpdate = async (req, res) => res.json({ todo: await todo.update(u(req), id(req), V.parseTodo(req.body)) });
exports.todoComplete = async (req, res) => res.json({ todo: await todo.setCompleted(u(req), id(req), !!(req.body && req.body.completed === true)) });
exports.todoRemove = async (req, res) => res.json({ todo: await todo.remove(u(req), id(req)) });
exports.todoRestore = async (req, res) => res.json({ todo: await todo.restore(u(req), id(req)) });
