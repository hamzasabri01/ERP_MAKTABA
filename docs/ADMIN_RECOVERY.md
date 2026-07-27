# Recuperation locale d'un administrateur

Cette procedure est reservee a un operateur ayant deja un acces local autorise au serveur. Elle ne cree pas de nouvel administrateur et n'affiche jamais le mot de passe.

## Procedure

1. Arreter le backend pour eviter toute ecriture concurrente.
2. Verifier qu'une sauvegarde recente existe. L'outil cree egalement une sauvegarde juste avant la modification.
3. Depuis `backend/`, lancer:

```powershell
..\.venv\Scripts\python.exe tools\recover_admin_account.py --username NOM_ADMIN --execute
```

4. Le mot de passe est lu deux fois avec `getpass`; il ne doit pas etre passe dans la ligne de commande.
5. Redemarrer le backend et se connecter. Toutes les anciennes sessions du compte sont revoquees.

Si tous les facteurs MFA sont perdus, ajouter explicitement `--reset-mfa`. Pour un compte desactive, ajouter explicitement `--reactivate`. Ces options sont journalisees dans Audit Log.

Sans `--execute`, l'outil reste en mode dry-run. Il refuse un utilisateur qui ne possede pas le role administrateur complet.

## Rollback

Restaurer uniquement la sauvegarde `before-admin-recovery` creee par l'outil, d'abord dans une base de test. Une restauration remet egalement les anciennes sessions et l'ancien etat MFA; elle doit donc rester une action d'incident exceptionnelle.
