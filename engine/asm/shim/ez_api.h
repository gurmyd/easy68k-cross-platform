/*
 * ez_api.h - the C interface of the assembler engine (implemented in
 * ez_host.cpp). Used by native/driver.cpp; the WebAssembly build exports
 * the same functions to asm68k.mjs.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * Strings are NUL-terminated byte strings in Windows-1252. File and source
 * contents are byte arrays. One assembly per process / instance.
 */
#ifndef EZ_API_H
#define EZ_API_H

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EZ_API EMSCRIPTEN_KEEPALIVE
#else
#define EZ_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Inputs */
EZ_API int  ez_fs_add(const char *name, const unsigned char *data, int len);
EZ_API void ez_set_options(int list, int obj, int cex, int bit, int cre,
                           int mex, int sex, int war, int tabType, int tabSize);
EZ_API void ez_set_time(int year, int month, int day, int hour, int minute, int second);
EZ_API int  ez_assemble(const char *workName, const unsigned char *source, int len);

/* Results */
EZ_API int  ez_error_count(void);
EZ_API int  ez_warning_count(void);
EZ_API int  ez_execute_enabled(void);
EZ_API int  ez_exit_called(void);
EZ_API int  ez_open_file_count(void);
EZ_API int  ez_msg_count(void);
EZ_API int  ez_msg_line(int i);
EZ_API const char *ez_msg_text(int i);
EZ_API const char *ez_msg_file(int i);
EZ_API int  ez_msg_code(int i);
EZ_API int  ez_msg_file_node(int i);
EZ_API int  ez_dialog_count(void);
EZ_API const char *ez_dialog_caption(int i);
EZ_API const char *ez_dialog_text(int i);
EZ_API int  ez_fs_count(void);
EZ_API int  ez_fs_deleted(int i);
EZ_API const char *ez_fs_name(int i);
EZ_API const char *ez_fs_key(int i);
EZ_API int  ez_fs_size(int i);
EZ_API const unsigned char *ez_fs_data(int i);
EZ_API int  ez_fs_find(const char *name);
EZ_API int  ez_output_node(int which);
EZ_API void *ez_alloc(int n);
EZ_API void ez_free(void *p);

#ifdef __cplusplus
}
#endif

#endif
